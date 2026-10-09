// Visual and functional smoke checks; all business requests use local fixtures.
const { chromium } = require('../../tmp/ui-check/node_modules/playwright-core');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
 const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
 const errors=[]; page.on('pageerror',e=>errors.push(e.message));
 let posts=0, uploads=0, camera=0, failLeaves=false;
 let profileStore='TechZone Flagship Store';
 let serverUnavailable=false;
 page.on('filechooser',()=>camera++);
 const date = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname;let data;
  if(serverUnavailable && path.endsWith('/auth/me')) return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Máy chủ đang tạm dừng. Thử tải lại.'})});
  if(/mobile-attendance\/(check-in|check-out)$/.test(path))posts++;
  if(path.endsWith('/photo'))uploads++;
  if(path.endsWith('/auth/login'))data={access_token:'fixture-only'};
  else if(path.endsWith('/auth/me'))data={employee_id:17,user_id:17,username:'fixture',full_name:'Nguyễn Minh Anh',employee_code:'TZ-0198',roles:['EMPLOYEE'],position_name:'Nhân viên bán hàng',store_name:'TechZone Flagship Store',department_name:'Kinh doanh',email:'fixture@example.invalid',phone:'0900000000'};
  else if(path.endsWith('/today-status'))data={work_date:date,can_check_in:true,can_check_out:false,cooldown_seconds_remaining:0,checkout_seconds_remaining:0,shift_id:1,shift_name:'Ca sáng',status:'NOT_CHECKED_IN',schedule_status:'MATCHED'};
  else if(path.endsWith('/my-schedules'))data=[{schedule_id:1,work_date:date,shift_id:1,shift_name:'Ca sáng',start_time:'08:00:00',end_time:'16:00:00',store_name:'TechZone Flagship Store'}];
  else if(path.endsWith('/shifts'))data=[{shift_id:1,shift_name:'Ca sáng',start_time:'08:00:00',end_time:'16:00:00'}];
  else if(path.endsWith('/my-history'))data=[{attendance_id:999,work_date:date,shift_name:'Ca sáng',check_in_time:`${date}T08:00:00+07:00`,check_out_time:`${date}T16:00:00+07:00`,actual_work_hours:8,late_minutes:0,early_minutes:0,overtime_hours:0,status:'NORMAL',schedule_status:'MATCHED',store_name:'TechZone Flagship Store'}];
  else if(path.endsWith('/geofence'))data={store_name:'TechZone Flagship Store',store_address:'TECHZONE Store, Quận 3',latitude:10.779356986985812,longitude:106.68418923912378,radius_meters:100};
  else if(path.endsWith('/leaves/types'))data=[{leave_type_id:1,type_code:'PHEP_NAM',type_name:'Phép năm',requires_attachment:false,is_paid:true,max_days_allowed:12}];
  else if(path.endsWith('/balances/me'))data={employee_id:17,annual_leave_total:12,annual_leave_used:2,annual_leave_remaining:10,sick_leave_used:0,pending_leave_days:1,unpaid_leave_used:0,maternity_leave_used:0,seniority_bonus_days:0};
  else if(path.endsWith('/leaves')){
   if(failLeaves)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'Không tải được đơn từ. Vui lòng thử lại.'})});
   data=[{request_id:7,employee_id:17,leave_type_id:1,leave_type_name:'Phép năm',leave_type_code:'PHEP_NAM',start_date:date,end_date:date,total_days:1,reason:'Việc gia đình',status:'PENDING',created_at:`${date}T08:00:00+07:00`}];
  }
  else if(path.endsWith('/my-summary'))data={employee_name:'Nguyễn Minh Anh',working_days:{actual_days:1,standard_days:26,total_hours:8},leave_quota:{annual_leave:12,used_leave:2,remaining_leave:10},late_arrivals:{count:0,minutes:0},early_departures:{count:0,minutes:0},overtime:{hours:0,shifts_count:0},extra_work:{hours:0},business_trips:{days:0},compensatory_leave:{total:0}};
  else return route.fulfill({status:404,contentType:'application/json',body:'{"detail":"Fixture endpoint missing"}'});
  if(path.endsWith('/auth/me')) data.store_name=profileStore;
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 try{
  await page.goto('http://localhost:8081/login',{waitUntil:'domcontentloaded',timeout:90000});
  await page.getByLabel('Tên đăng nhập',{exact:true}).waitFor();
  await page.waitForTimeout(1500); // Expo web hydrates the server-rendered login before accepting input.
  await page.getByLabel('Tên đăng nhập',{exact:true}).fill('fixture'); await page.getByLabel('Mật khẩu',{exact:true}).fill('fixture-only');
  await page.screenshot({path:'tmp/mobile-stitch-login.png'});
  await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
  await page.getByText('Xin chào,',{exact:true}).waitFor();
  assert.equal(await page.getByRole('tab').count(),5);
  assert.equal(await page.locator('iframe').count(),0);
  assert.equal(await page.getByText(/Flagship/).count(),0);
  await page.screenshot({path:'tmp/mobile-stitch-home.png'});
  // HR changes the profile while the employee stays on Home; old schedule remains.
  profileStore='TECHZONE Store - Tân Bình';
  await page.getByText(/Nhân viên bán hàng • TECHZONE Store - Tân Bình/).waitFor({timeout:45000});
  await page.getByText('Cửa hàng trong lịch phân ca: TECHZONE Store',{exact:true}).waitFor();
  await page.screenshot({path:'tmp/mobile-store-transfer.png'});
  await page.getByRole('tab',{name:/Lịch ca/}).click();
  await page.getByText('Đã xếp ca',{exact:true}).waitFor();
  await page.screenshot({path:'tmp/mobile-stitch-schedules.png'});
  await page.getByRole('tab',{name:/Đơn từ/}).click();
  await page.getByText('Chờ CHT duyệt',{exact:true}).waitFor();
  await page.screenshot({path:'tmp/mobile-stitch-requests.png'});
  await page.getByRole('tab',{name:/Chấm công/}).click();
  await page.getByRole('button',{name:'Chấm công vào',exact:true}).last().waitFor();
  assert.equal(await page.getByText('Xác nhận chấm công',{exact:true}).count(),0);
  assert.equal(await page.getByText('Ca thực tế',{exact:true}).count(),0);
  await page.screenshot({path:'tmp/mobile-stitch-attendance.png'});
  await page.context().grantPermissions(['geolocation']);
  await page.context().setGeolocation({latitude:10.748,longitude:106.635,accuracy:12});
  assert.equal(camera,0); assert.equal(posts,0);
  serverUnavailable=true;
  await page.getByRole('button',{name:'Chấm công vào',exact:true}).last().click();
  await page.getByText('Máy chủ đang tạm dừng. Thử tải lại.',{exact:true}).last().waitFor();
  assert.equal(camera,0);assert.equal(uploads,0);assert.equal(posts,0);
  serverUnavailable=false;
  await page.getByRole('button',{name:'Thử tải lại',exact:true}).last().click();
  await page.getByRole('button',{name:'Chấm công vào',exact:true}).last().click();
  await page.getByText('GPS của bạn đang ngoài vùng cho phép',{exact:true}).waitFor({timeout:30000});
  assert.equal(camera,0);assert.equal(uploads,0);assert.equal(posts,0);
  await page.waitForTimeout(500); // Let the modal transition finish before the visual capture.
  await page.screenshot({path:'tmp/mobile-stitch-outside.png'});
  await page.getByRole('button',{name:'Quay lại chấm công'}).click();
  await page.getByRole('tab',{name:/Tài khoản/}).click();
  await page.screenshot({path:'tmp/mobile-stitch-account.png'});
  await page.getByRole('button',{name:/Giao diện & Tiện ích/}).click();
  await page.getByRole('button',{name:/Giao diện Tối/}).click();
  await page.getByRole('tab',{name:/Trang chủ/}).click();
  await page.screenshot({path:'tmp/mobile-stitch-home-dark.png'});
  await page.getByRole('tab',{name:/Chấm công/}).click();
  await page.getByRole('button',{name:'Chấm công vào',exact:true}).last().click();
  await page.getByText('GPS của bạn đang ngoài vùng cho phép',{exact:true}).waitFor();
  assert.equal(camera,0);assert.equal(uploads,0);assert.equal(posts,0);
  await page.getByRole('button',{name:'Quay lại chấm công'}).click();
  await page.getByRole('tab',{name:/Đơn từ/}).click();
  await page.getByRole('button',{name:/Tạo đơn xin nghỉ phép mới/}).click();
  await page.screenshot({path:'tmp/mobile-stitch-leave-form-dark.png'});
  assert.deepEqual(errors,[]);
  console.log('PASS: five tabs, assigned shift, no manual selector/confirmation panel, icon action, GPS before camera, zero outside writes, dark mode.');
 }catch(error){await page.screenshot({path:'tmp/mobile-stitch-failure.png'});console.log((await page.locator('body').innerText()).slice(-6500));throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
