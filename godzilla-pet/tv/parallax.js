/* Three reusable transparent city strips; no growing scene-object list. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HarborParallax=api;})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const layers=[{key:'far',speed:.18,height:470},{key:'mid',speed:.42,height:340},{key:'near',speed:.72,height:265}];
 function tiles(camera,speed,width,viewport){
  const offset=((camera*speed)%(width*2)+width*2)%(width*2),first=Math.floor(offset/width),result=[];
  for(let i=first,x=i*width-offset;x<viewport;i++,x+=width)result.push({x,flip:i%2===1});
  return result;
 }
 function draw(ctx,images,camera,w,h,baseline,scale){
  const sky=ctx.createLinearGradient(0,0,0,baseline);sky.addColorStop(0,'#261c3b');sky.addColorStop(.55,'#773957');sky.addColorStop(1,'#ed8c58');ctx.fillStyle=sky;ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#ffaf55';ctx.beginPath();ctx.arc(w*.18,118,48,0,Math.PI*2);ctx.fill();
  for(let i=0;i<17;i++){ctx.fillStyle=i%2?'#b5586348':'#652e534d';ctx.fillRect((i*197)%w,80+(i%5)*39,78+i%4*31,5);ctx.fillRect((i*197)%w+22,75+(i%5)*39,53,5);}
  ctx.save();ctx.imageSmoothingEnabled=false;
  for(const layer of layers){const img=images[layer.key];if(!img||!img.complete||!img.naturalWidth)continue;
   const height=layer.height,width=Math.round(height*img.naturalWidth/img.naturalHeight);
   // Alternating forward/back tiles meet the identical source edge at every join.
   // Camera scale animates as the creature grows; it must not alter travel distance.
   for(const tile of tiles(camera,layer.speed,width,w)){ctx.save();ctx.translate(tile.x+(tile.flip?width:0),baseline-height);ctx.scale(tile.flip?-1:1,1);ctx.drawImage(img,0,0,width,height+2);ctx.restore();}
  }
  ctx.restore();
 }
 return {layers,tiles,draw};
});
