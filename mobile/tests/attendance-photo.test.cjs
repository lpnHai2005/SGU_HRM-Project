const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const transpile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const converter = {};
vm.runInNewContext(transpile('../node_modules/expo/src/winter/fetch/convertFormData.ts'), {
  exports: converter, Blob, TextEncoder, Uint8Array,
  require: () => ({blobToArrayBufferAsync: blob => blob.arrayBuffer()}),
});
class TestFormData {
  parts = [];
  append(name, value) { this.parts.push([name, value]); }
  entries() { return this.parts; }
}
test('reproduces Expo 57 rejection of the old native URI object before HTTP', async () => {
  const form = new TestFormData();
  form.append('file', {uri:'file:///camera.jpg',name:'selfie.jpg',type:'image/jpeg'});
  await assert.rejects(converter.convertFormDataAsync(form), /Unsupported FormDataPart implementation/);
});
function setup({size=100, failUpload=false}={}) {
  const state = {deleted:false, uploaded:false, resize:null, saved:null};
  class NativeFile {
    constructor(uri) { this.uri=uri;this.name='normalized.jpg';this.type='image/jpeg';this.exists=true;this.size=size; }
    async bytes() { return new Uint8Array([255,216,255,217]); }
    delete() { this.exists=false;state.deleted=true; }
  }
  const context={resize: value => {state.resize=value;},release(){},renderAsync:async()=>({release(){},saveAsync:async value=>{state.saved=value;return {uri:'file:///normalized.jpg'};}})};
  const exports={};
  vm.runInNewContext(transpile('../src/services/attendance-photo.ts'), {exports, FormData:TestFormData, require: name=>{
    if(name==='react-native') return {Platform:{OS:'android'}};
    if(name==='expo-file-system') return {File:NativeFile};
    if(name==='expo-image-manipulator') return {ImageManipulator:{manipulate:()=>context},SaveFormat:{JPEG:'jpeg'}};
    if(name==='./attendance') return {request:async(url,token,body,form)=>{
      state.uploaded=true;assert.equal(url,'/mobile-attendance/photo');assert.equal(token,'token');
      const encoded=await converter.convertFormDataAsync(form,'test-boundary');
      const text=new TextDecoder().decode(encoded.body);
      assert.ok(text.includes('filename="normalized.jpg"'));assert.ok(text.includes('content-type: image/jpeg'));
      if(failUpload)throw Error('upload failed');return {photo_token:'proof'};
    }};
    throw Error(name);
  }});
  return {state,upload:()=>exports.uploadAttendancePhoto({uri:'file:///camera.heic',width:4000,height:3000},'token')};
}
test('new photo path uses JPEG File bytes accepted by the real Expo serializer',async()=>{
  const {state,upload}=setup();assert.equal((await upload()).photo_token,'proof');
  assert.equal(state.resize.width,1600);assert.equal(state.saved.format,'jpeg');assert.equal(state.deleted,true);
});
test('oversize normalized photo is rejected before HTTP and cleaned up',async()=>{
  const {state,upload}=setup({size:6*1024*1024});await assert.rejects(upload(),/5 MB/);
  assert.equal(state.uploaded,false);assert.equal(state.deleted,true);
});
test('failed upload preserves its error and cleans up temporary JPEG',async()=>{
  const {state,upload}=setup({failUpload:true});await assert.rejects(upload(),/upload failed/);assert.equal(state.deleted,true);
});
