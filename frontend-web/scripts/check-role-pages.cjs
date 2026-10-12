// Role/UI fixtures, no real payroll or store is written.
const {chromium}=require('../../tmp/ui-check/node_modules/playwright-core')
const assert=require('node:assert/strict')
;(async()=>{const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 try{for(const role of ['ADMIN','STORE_MANAGER','EMPLOYEE']){
  const page=await browser.newPage({viewport:{width:1280,height:900}})
  const user={user_id:42,employee_id:42,roles:[role],store_id:1,username:'fixture',full_name:'Nhân viên Fixture',permissions:[]}
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(value=>{localStorage.setItem('hrm_token','fixture');localStorage.setItem('hrm_user',JSON.stringify(value))},user)
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());let data=[]
   if(url.pathname.endsWith('/auth/me'))data={...user,employee_code:'TEST-42',store_name:'TECHZONE Store',position_name:'Nhân viên',department_name:'Kinh doanh'}
   if(url.pathname.endsWith('/stores'))data=[{store_id:1,store_code:'TZ01',store_name:'TECHZONE Store',address:'Địa chỉ thử nghiệm',latitude:10.77,longitude:106.7,radius_meters:100,is_active:true}]
   if(url.pathname.endsWith('/operations/filter-options'))data={employees:[{employee_id:42,full_name:user.full_name}],departments:[{id:1,name:'Kinh doanh'}],stores:[{id:1,name:'TECHZONE Store'}]}
   if(url.pathname.endsWith('/operations/monthly-attendance'))data={period:'2026-10',employees:[{employee_id:42,employee_name:user.full_name,store_name:'TECHZONE Store',department_name:'Kinh doanh',scheduled_hours:8,actual_work_hours:8.5,late_minutes:20,early_minutes:0,overtime_hours:0.5,working_days:1,leave_days:0,statuses:['LATE'],sessions:[{attendance_id:1,work_date:'2026-10-12',shift_name:'Ca sáng',check_in_time:'2026-10-12T08:20:00+07:00',check_out_time:'2026-10-12T17:30:00+07:00',actual_work_hours:8.5,late_minutes:20,early_minutes:0,overtime_hours:0.5,status:'LATE',schedule_status:'MATCHED'}]}]}
   if(url.pathname.endsWith('/operations/activity'))data={summary:{total:0,checked_in:0,working:0,finished:0,not_checked_in:0,late:0,early:0,overtime:0},employees:[]}
   if(url.pathname.endsWith('/payrolls'))data=[]
   if(url.pathname.endsWith('/payrolls/overtime-approvals'))data=[]
   if(url.pathname.endsWith('/mobile-attendance/assigned-shift'))data={shift_name:'Ca sáng',start_time:'08:00:00',end_time:'16:00:00',store_name:'TECHZONE Store'}
   if(url.pathname.endsWith('/attendances/today-status'))data={work_date:'2026-10-12',has_checked_in:false,has_checked_out:false,can_check_out:false,actual_work_hours:0}
   if(url.pathname.endsWith('/mobile-attendance/my-schedules'))data=[]
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
  })
  await page.goto('http://127.0.0.1:3000/account')
  await page.getByText('Ca và giờ công hôm nay').waitFor()
  assert((await page.locator('body').innerText()).includes('TECHZONE Store'))
  if(role==='ADMIN'){
   await page.goto('http://127.0.0.1:3000/stores');await page.getByText('Địa chỉ thử nghiệm').waitFor()
   await page.getByRole('button',{name:'Thêm cửa hàng'}).click();await page.getByRole('dialog').waitFor()
   await page.getByPlaceholder('192.168.1.0/24\n203.0.113.25/32').fill('192.168.1.0/24')
   assert.equal(await page.getByRole('dialog').locator('textarea').inputValue(),'192.168.1.0/24')
   await page.getByRole('button',{name:'Đóng'}).last().click()
  }else{
   assert.equal(await page.locator('.sidebar-nav').getByText('Quản lý cửa hàng').count(),0)
  }
  if(role!=='EMPLOYEE'){
   await page.goto('http://127.0.0.1:3000/attendance');await page.getByText('Nhân viên Fixture').last().waitFor()
   await page.locator('summary').first().click();assert((await page.locator('body').innerText()).includes('OT 0.5'))
  }
  await page.goto('http://127.0.0.1:3000/activity')
  await page.locator('.work-date-field input').first().click()
  await page.getByRole('button',{name:'Tháng sau'}).click()
  assert.equal(await page.locator('.work-date-popover').count(),1)
  const box=await page.locator('.work-date-popover').boundingBox()
  assert(box && box.x>=0 && box.x+box.width<=1280 && box.y>=0 && box.y+box.height<=900)
  if(role==='ADMIN'){
   await page.keyboard.press('Escape');await page.setViewportSize({width:360,height:640})
   await page.locator('.work-date-field input').first().click()
   await page.getByRole('button',{name:'Tháng sau'}).click()
   const narrow=await page.locator('.work-date-popover').boundingBox()
   assert(narrow && narrow.x>=0 && narrow.x+narrow.width<=360 && narrow.y>=0 && narrow.y+narrow.height<=640)
  }
  if(role==='STORE_MANAGER'){
   await page.goto('http://127.0.0.1:3000/payroll');await page.waitForLoadState('networkidle');assert.equal(await page.getByRole('button',{name:/Chốt.*Tính Lương/}).count(),0)
  }
  if(role==='EMPLOYEE'){
   await page.goto('http://127.0.0.1:3000/');await page.locator('.attendance-hero').waitFor()
   await page.getByText('Ca sáng',{exact:true}).first().waitFor()
   assert((await page.locator('main.main-content').getAttribute('class')).includes('main-content'))
  }
  assert.deepEqual(errors,[])
  await page.close()
 }
 console.log('PASS: Admin store editor, role navigation/profile, scoped monthly drilldown, manager payroll read-only. Fixtures only.')
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
