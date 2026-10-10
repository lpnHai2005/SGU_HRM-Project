// Browser fixtures only: never creates schedules in the real database.
const { chromium } = require('../../tmp/ui-check/node_modules/playwright-core');
const assert = require('node:assert/strict');
(async () => {
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1366,height:1000}});
  const user={user_id:1,employee_id:1,store_id:1,roles:['HR_MANAGER'],permissions:[],full_name:'Manager',username:'fixture'};
  const employee={employee_id:4,employee_code:'TZ-004',full_name:'Staff fixture',store_id:1,store_name:'TECHZONE Store',employment_status:'ACTIVE'};
  const posts=[]; const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(user=>{localStorage.setItem('hrm_token','fixture-only');localStorage.setItem('hrm_user',JSON.stringify(user));},user);
  await page.route('**/api/**',async route=>{
   const req=route.request();const path=new URL(req.url()).pathname;
   let data=[];
   if(req.method()==='POST'){posts.push({path,body:req.postDataJSON()});data={message:'Fixture saved'};}
   else if(path.endsWith('/auth/me'))data=user;
   else if(path.includes('lookups'))data={stores:[{store_id:1,store_name:'TECHZONE Store'}],positions:[],departments:[],education_levels:[]};
   else if(path.endsWith('/employees'))data=[employee];
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('http://localhost:3000/employees');
  await page.getByTitle('Phân ca / Sửa ca làm').click();
  const fixed=page.getByRole('radio',{name:'Ca cố định',exact:true});
  const daily=page.getByRole('radio',{name:'Phân ca theo ngày',exact:true});
  const notes=page.locator('input[placeholder="Ghi chú phân công ca trực tuần..."]');
  assert.equal(await daily.isChecked(),true);
  await notes.fill('Custom daily notes');await fixed.check();
  assert.equal(await notes.inputValue(),'Phân ca nhân viên chính thức');
  assert.match(await page.locator('fieldset').innerText(),/Chủ nhật/);
  const dateInput=page.getByPlaceholder('DD/MM/YYYY');
  assert.match(await dateInput.inputValue(),/^\d{2}\/\d{2}\/\d{4}$/);
  const radioBounds=await fixed.boundingBox(),dateBounds=await dateInput.boundingBox();
  assert(radioBounds.y<dateBounds.y);
  await daily.check();assert.equal(await notes.inputValue(),'Custom daily notes');
  await fixed.check();await page.screenshot({path:'tmp/fixed-schedule-form.png',fullPage:true});
  await page.getByRole('button',{name:'Lưu phân ca',exact:true}).click();
  await page.getByTitle('Phân ca / Sửa ca làm').click();
  assert.equal(await daily.isChecked(),true);
  await dateInput.fill('31/02/2026');
  await page.getByRole('button',{name:'Lưu phân ca',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Nhập ngày hợp lệ'}).waitFor();
  assert.equal(posts.length,1);
  await dateInput.fill('10/11/2026');
  await page.getByRole('button',{name:'Lưu phân ca',exact:true}).click();
  await page.waitForTimeout(300);
  assert.equal(posts.length,2);
  assert(posts[0].path.endsWith('/fixed-schedules'));
  assert.equal(posts[0].body.notes,'Phân ca nhân viên chính thức');
  assert(posts[1].path.endsWith('/attendances/shift-schedules'));
  assert.equal(posts[1].body.work_date,'2026-11-10');
  assert.deepEqual(errors,[]);
  console.log('PASS: radio above date, automatic/restored notes, fixed/daily payload separation, modal reset, no browser errors. Fixture only.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
