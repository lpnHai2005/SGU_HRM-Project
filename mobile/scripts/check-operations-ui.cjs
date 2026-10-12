// Expo web smoke test with isolated API fixtures; no real attendance writes.
const {chromium}=require('../../tmp/ui-check/node_modules/playwright-core');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{
 const width=Number(process.argv[2]||390),scheme=process.argv[3]||'light';
 const page=await browser.newPage({viewport:{width,height:844},colorScheme:scheme});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 const capture=async name=>{
  await page.waitForTimeout(400);
  await page.screenshot({path:`tmp/mission4-ui/${name}-${width}-${scheme}.png`,fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Page must not overflow horizontally');
  const emoji=await page.evaluate(()=>{const result=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while((node=walker.nextNode())){if(/\p{Extended_Pictographic}/u.test(node.textContent)&&node.parentElement?.getBoundingClientRect().width)result.push(node.textContent)}return result});
  assert.deepEqual(emoji,[],'Decorative emoji must use AppIcon');
  assert(!/\b(person|lock-closed|calendar|warning|checkmark)-outline\b/.test(await page.locator('body').innerText()),'Icon names must never render as text');
 };
 const day=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Ho_Chi_Minh'});
 await page.route('**/api/v1/**',async route=>{
 const path=new URL(route.request().url()).pathname;let data=[];
 if(path.endsWith('/auth/login'))data={access_token:'fixture-only'};
 if(path.endsWith('/auth/me'))data={user_id:99,employee_id:99,username:'fixture',full_name:'HR fixture',roles:['HR_MANAGER'],store_id:1,store_name:'TECHZONE Store',department_name:'Nhân sự'};
 if(path.endsWith('/today-status'))data={work_date:day,can_check_in:false,can_check_out:false,cooldown_seconds_remaining:0,checkout_seconds_remaining:0,status:'NOT_CHECKED_IN'};
 if(path.endsWith('/my-summary'))data={working_days:{actual_days:1,standard_days:26,total_hours:8},leave_quota:{remaining_leave:10},late_arrivals:{count:0,minutes:0},early_departures:{count:0,minutes:0},overtime:{hours:0,shifts_count:0}};
 if(path.endsWith('/dashboard-stats'))data={active_employees:2,pending_leaves:1,attendance_today:{checked_in:2,working:1,late:1},monthly_net_payroll_fund:10000000,monthly_gross_payroll_fund:12000000,total_retail_revenue:20000000};
 if(path.endsWith('/summary/stats'))data={pending_store_approval:1,pending_hr_approval:0,approved:2,rejected:0,on_leave_today:0};
 if(path.endsWith('/payroll-fund'))data={summary:{},by_unit:[]};
 if(path.endsWith('/operations/filter-options'))data={employees:[{employee_id:1,full_name:'Staff A'}],stores:[{id:1,name:'TECHZONE Store'}],departments:[{id:10,name:'Kinh doanh'}]};
 if(path.endsWith('/work-schedules'))data=[{schedule_id:1,employee_name:'Staff A',work_date:day,shift_name:'Ca sáng',start_time:'08:00:00',end_time:'12:00:00',store_name:'TECHZONE Store'}];
 if(path.endsWith('/operations/activity'))data={summary:{total:2,checked_in:1,working:1,finished:0,not_checked_in:1,late:1,early:0,overtime:1},employees:[{employee_id:1,employee_name:'Staff A',store_name:'TECHZONE Store',department_name:'Kinh doanh',sessions:[{attendance_id:1,shift_name:'Ca sáng',check_in_time:`${day}T08:20:00+07:00`,check_out_time:null,status:'LATE',schedule_status:'MATCHED',late_minutes:20,early_minutes:0,overtime_hours:1,actual_work_hours:4}]}]};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://localhost:8081/login',{timeout:120000});
 await page.getByLabel('Tên đăng nhập',{exact:true}).waitFor();await page.waitForTimeout(1500);await capture('login');
 await page.getByLabel('Tên đăng nhập',{exact:true}).fill('fixture');await page.getByLabel('Mật khẩu',{exact:true}).fill('fixture-only');await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
 await page.getByLabel('Mở menu nhân viên').waitFor();await capture('home');
 await page.getByRole('tab',{name:'Báo cáo KPI'}).click();
 const homeWorking=await page.getByText('Đang làm hôm nay',{exact:true}).locator('..').locator('..').innerText();
 assert.match(homeWorking,/\b1\b/,'Home must show one open session, not both employees who checked in');
 await page.getByRole('tab',{name:'Tiện ích'}).click();
 await page.getByLabel('Mở menu nhân viên').click();await capture('sidebar');await page.getByLabel('Đóng menu',{exact:true}).first().click();
 await page.getByRole('tab',{name:/Lịch ca/}).click();
 await page.getByRole('button',{name:'Nhân viên',exact:true}).click();await page.getByText('Staff A',{exact:true}).waitFor();
 await page.screenshot({path:'tmp/mission4-mobile-schedules.png',fullPage:true});
 await capture('schedules');await page.getByLabel('Bộ lọc nâng cao',{exact:true}).click();await capture('schedule-filters');await page.getByLabel('Bộ lọc nâng cao',{exact:true}).click();
 await page.getByRole('button',{name:new RegExp(day.split('-').reverse().join('/'))}).click();
 await page.getByRole('button',{name:'Đóng',exact:true}).click();
 await page.screenshot({path:'tmp/mission4-mobile-calendar-close.png',fullPage:true});
 await page.getByRole('tab',{name:/Trang chủ/}).click();await page.getByLabel('Mở menu nhân viên').click();
 await page.getByText('Báo cáo tổng hợp & KPI',{exact:true}).click();
 await page.getByRole('button',{name:/Đi muộn hôm nay/}).waitFor();await capture('dashboard');
 const dashboardWorking=await page.getByRole('button',{name:/Đang làm hôm nay/}).innerText();
 assert.match(dashboardWorking,/\b1\b/,'Dashboard must use open sessions for current workforce');
 await page.getByRole('button',{name:/Đi muộn hôm nay/}).click();
 await page.getByText('Staff A',{exact:true}).waitFor();await page.getByRole('button',{name:/Staff A/}).click();
 await page.getByText(/OT thực tế: 1 giờ/).waitFor();
 await page.screenshot({path:'tmp/mission4-mobile-activity.png',fullPage:true});
 await capture('activity');
 assert.deepEqual(errors,[]);console.log('PASS: manager schedule tab/filters/date picker, KPI drilldown, session metrics, no JS errors. Expo web fixtures only.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
