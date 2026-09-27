const {test}=require('node:test'),assert=require('node:assert/strict');
const {tiles,layers,draw}=require('../parallax.js');
test('city parallax: ordered independent speeds and constant viewport coverage',()=>{
 assert.ok(layers.every((layer,i)=>layer.speed<1&&(i===0||layers[i-1].speed<layer.speed)));
 for(const layer of layers)for(const camera of [-10000,0,1999.9,2000,1e9]){
  const list=tiles(camera,layer.speed,1000,1280);assert.ok(list.length<=3);assert.ok(list[0].x<=0);assert.ok(list.at(-1).x+1000>=1280);
  for(let i=1;i<list.length;i++){assert.equal(list[i].x-list[i-1].x,1000);assert.notEqual(list[i].flip,list[i-1].flip);}
  const repeat=tiles(camera+2000/layer.speed,layer.speed,1000,1280);assert.equal(repeat.length,list.length);list.forEach((t,i)=>{assert.ok(Math.abs(t.x-repeat[i].x)<.00001);assert.equal(t.flip,repeat[i].flip);});
 }
});
test('city parallax: camera zoom changes cannot reverse horizontal travel',()=>{
 const images=Object.fromEntries(layers.map(({key})=>[key,{complete:true,naturalWidth:2172,naturalHeight:724}]));
 function positions(camera,scale){const points={};let lastX=0;const ctx={fillRect(){},beginPath(){},arc(){},fill(){},save(){},restore(){},scale(){},drawImage(img){const key=layers.find(({key})=>images[key]===img).key;if(!(key in points))points[key]=lastX;},translate(x){lastX=x;},createLinearGradient(){return {addColorStop(){}}}};
 draw(ctx,images,camera,1280,720,488,scale);return points;
 }
 // Tile start should never move right while the world camera increases, even when zoom falls.
 const before=positions(200,.95),after=positions(220,.7);
 for(const key of Object.keys(before))assert.ok(after[key]<=before[key],key+' moved backwards');
});
