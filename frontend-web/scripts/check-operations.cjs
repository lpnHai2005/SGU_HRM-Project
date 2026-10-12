// Browser fixtures only. No business data is written.
const {chromium}=require('../../tmp/ui-check/node_modules/playwright-core');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const user={user_id:99,employee_id:99,roles:['HR_MANAGER'],username:'fixture',full_name:'HR fixture',permissions:[]};
 const errors=[],queries=[];let noticeVersion=1,noticeRead=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(user=>{localStorage.setItem('hrm_token','fixture');localStorage.setItem('hrm_user',JSON.stringify(user))},user);
 await page.clock.install({time:new Date('2026-10-18T10:00:00+07:00')});
 await page.route('**/api/**',async route=>{
 const url=new URL(route.request().url());let data=[];
 if(url.pathname.endsWith('/auth/me'))data=user;
 if(url.pathname.endsWith('/dashboard-stats'))data={active_employees:3,pending_leaves:1,attendance_today:{checked_in:2,working:1,late:1},monthly_net_payroll_fund:10000000,monthly_gross_payroll_fund:12000000,total_retail_revenue:200000000};
 if(url.pathname.endsWith('/summary/stats'))data={pending_store_approval:1,pending_hr_approval:0,approved:2,rejected:0,on_leave_today:0};
 if(url.pathname.endsWith('/operations/notifications'))data=[{id:`n${noticeVersion}`,title:`Đơn cần xử lý ${noticeVersion}`,href:'/leave',is_read:noticeVersion===1&&noticeRead}];
 if(url.pathname.endsWith('/operations/notifications/n1/read')){noticeRead=true;data={notice_id:'n1',is_read:true}}
 if(url.pathname.endsWith('/operations/filter-options'))data={employees:[{employee_id:1,full_name:'Nhân viên A'}],stores:[{id:1,name:'TECHZONE Store'}],departments:[{id:10,name:'Kinh doanh'}]};
 if(url.pathname.endsWith('/operations/activity')){queries.push(url.search);data={summary:{total:3,checked_in:1,working:1,finished:0,not_checked_in:2,late:1,early:0,overtime:1},employees:[{employee_id:1,employee_name:'Nhân viên A',store_name:'TECHZONE Store',department_name:'Kinh doanh',sessions:[{attendance_id:1,shift_name:'Ca sáng',check_in_time:'2026-10-18T08:15:00+07:00',check_out_time:'2026-10-18T12:00:00+07:00',status:'NORMAL',schedule_status:'MATCHED',late_minutes:15,early_minutes:0,overtime_hours:0,actual_work_hours:3.75},{attendance_id:2,shift_name:'Ca chiều',check_in_time:'2026-10-18T13:20:00+07:00',check_out_time:null,status:'LATE',schedule_status:'MATCHED',late_minutes:20,early_minutes:0,overtime_hours:1,actual_work_hours:4}]}]};}
 if(url.pathname.endsWith('/work-schedules'))queries.push(url.search);
 if(url.pathname.includes('lookups'))data={stores:[],work_shifts:[],departments:[],positions:[],education_levels:[]};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.goto('http://127.0.0.1:3000');
 await page.getByRole('heading',{name:'Quản lý báo cáo tổng hợp'}).waitFor();
 await page.getByRole('button',{name:'Đi muộn hôm nay',exact:false}).click();
 await page.locator('summary').filter({hasText:'Nhân viên A'}).waitFor();
 assert(!queries.some(q=>/employee_id=&|department_id=&/.test(q)));
 await page.locator('summary').filter({hasText:'Nhân viên A'}).click();
 assert.equal(await page.locator('tbody tr').count(),2);
 await page.screenshot({path:'tmp/mission4-activity-light.png',fullPage:true});
 await page.getByLabel('Toggle Theme').click();
 await page.screenshot({path:'tmp/mission4-activity-dark.png',fullPage:true});
 await page.getByRole('button',{name:/Thông báo:/}).click();
 await page.getByRole('group',{name:'Lọc thông báo'}).getByRole('button',{name:/Chưa đọc/}).click();
 assert.equal(await page.locator('.notification-item').count(),1);
 await page.screenshot({path:'tmp/mission4-notifications.png'});
 await page.getByRole('button',{name:'Đơn cần xử lý 1'}).waitFor();
 await page.getByRole('button',{name:'Đơn cần xử lý 1'}).click();
 await page.getByRole('button',{name:'Thông báo: 0 chưa đọc'}).waitFor();
 await page.reload();
 await page.getByRole('button',{name:'Thông báo: 0 chưa đọc'}).waitFor();
 noticeVersion=2;await page.clock.runFor(31000);
 await page.locator('[data-sonner-toast]').filter({hasText:'Đơn cần xử lý 2'}).waitFor();
 await page.goto('http://127.0.0.1:3000/work-schedules');
 await page.getByRole('button',{name:'Hôm nay',exact:true}).waitFor();
 const count=queries.length;await page.getByRole('button',{name:'Hôm nay',exact:true}).click();
 await page.waitForFunction(()=>document.body.textContent.includes('12/10/2026'));
 await new Promise(r=>setTimeout(r,300));
 assert(queries.length>count,'Today must reload even unchanged date');
 assert.match(await page.locator('body').innerText(),/12\/10\/2026 – 17\/10\/2026/);
 assert.deepEqual(errors,[]);
 console.log('PASS: KPI drilldown, no empty IDs, all sessions, light/dark render, notification refresh/toast, Sunday Today range/reload. Fixtures only.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
