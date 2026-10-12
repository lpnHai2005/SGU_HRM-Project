// Isolated fixture: no business request reaches the database.
const {chromium}=require('../../tmp/ui-check/node_modules/playwright-core')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
;(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}})
  const user={user_id:9901,employee_id:9901,roles:['HR_MANAGER'],username:'fixture',full_name:'HR fixture',permissions:[]}
  await page.addInitScript(value=>{localStorage.setItem('hrm_token','fixture');localStorage.setItem('hrm_user',JSON.stringify(value))},user)
  const payroll={payroll_id:1,employee_id:9902,employee_code:'TEST-002',employee_name:'Nhân viên Kiểm thử',position_name:'Nhân viên',store_name:'TECHZONE Store',salary_period:'2026-10',payment_status:'CONFIRMED',standard_working_days:26,actual_working_days:24,paid_leave_days:1,unpaid_leave_days:0,contract_salary:12000000,actual_base_salary:11000000,gross_income:13000000,total_deduction:1300000,net_salary:11700000,total_insurance:1300000,details:[]}
  const print={payroll_id:1,payroll_code:'PL-2026-10-0001',generated_date:'12/10/2026 14:00',salary_period:'2026-10',payslip_title:'PHIẾU LƯƠNG THÁNG 10/2026',company:{name:'TECHZONE RETAIL'},employee:{full_name:payroll.employee_name,employee_code:payroll.employee_code,position_name:payroll.position_name,store_name:payroll.store_name,bank_account:'Chưa cập nhật',bank_name:'Chưa cập nhật'},attendance:{standard_working_days:26,actual_working_days:24,paid_leave_days:1,unpaid_leave_days:0,unworked_hours:0},earnings:[{item_name:'Lương cơ bản thực tế',amount:11000000},{item_name:'Thưởng theo kết quả',amount:2000000}],deductions:[{item_name:'Bảo hiểm',amount:1300000}],summary:{gross_income:13000000,total_deduction:1300000,net_salary:11700000,net_salary_in_words:'Mười một triệu bảy trăm nghìn đồng'}}
  await page.route('**/api/**',async route=>{const u=new URL(route.request().url());let body=[]
    if(u.pathname.endsWith('/auth/me'))body=user
    if(u.pathname.endsWith('/payrolls'))body=[payroll]
    if(u.pathname.endsWith('/payrolls/1/payslip'))body=print
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)})
  })
  await page.goto('http://127.0.0.1:3000/payroll')
  await page.getByRole('button',{name:'In PDF'}).first().click()
  await page.locator('.payslip-a4-modal').waitFor()
  const text=await page.locator('.payslip-a4-modal').innerText()
  assert(text.includes(print.summary.net_salary_in_words))
  assert(text.includes('Chưa cập nhật'))
  assert(!text.includes('19036788899999'))
  await page.emulateMedia({media:'print'})
  assert(await page.locator('.payslip-a4-modal').isVisible())
  const dir=path.resolve(__dirname,'../../tmp/pdfs');fs.mkdirSync(dir,{recursive:true})
  const output=path.join(dir,'mission4-payslip-fixture.pdf')
  await page.locator('.payslip-a4-modal').screenshot({path:path.join(dir,'mission4-payslip-print-preview.png')})
  await page.pdf({path:output,format:'A4',printBackground:true,preferCSSPageSize:true})
  console.log(`PASS: approved A4 payslip renders API data; fixture PDF: ${output}`)
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1})
