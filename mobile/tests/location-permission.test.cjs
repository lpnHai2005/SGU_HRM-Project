const {test} = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const exportsForTest = {};
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/services/location-permission.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(source,{exports:exportsForTest});
const ensure = exportsForTest.ensureLocationPermission;
test('granted location does not prompt again',async()=>{
  const result = await ensure({getForegroundPermissionsAsync:async()=>({granted:true,canAskAgain:true}),requestForegroundPermissionsAsync:()=>assert.fail('unexpected prompt')});
  assert.equal(result.granted,true);
});
test('permanently denied requests settings without another prompt',async()=>{
  const result = await ensure({getForegroundPermissionsAsync:async()=>({granted:false,canAskAgain:false}),requestForegroundPermissionsAsync:()=>assert.fail('unexpected prompt')});
  assert.equal(result.granted,false); assert.equal(result.canAskAgain,false);
});
test('temporary denial may prompt and grant',async()=>{
  const result = await ensure({getForegroundPermissionsAsync:async()=>({granted:false,canAskAgain:true}),requestForegroundPermissionsAsync:async()=>({granted:true,canAskAgain:true})});
  assert.equal(result.granted,true);
});
test('denial of prompt remains denied',async()=>{
  const result = await ensure({getForegroundPermissionsAsync:async()=>({granted:false,canAskAgain:true}),requestForegroundPermissionsAsync:async()=>({granted:false,canAskAgain:false})});
  assert.equal(result.granted,false);
});
