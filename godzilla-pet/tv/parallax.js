/* Four reusable transparent city strips; no growing scene-object list. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HarborParallax=api;})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const layers=[{key:'haze',speed:.10,height:770,offset:340},{key:'far',speed:.18,height:555,offset:220},{key:'mid',speed:.42,height:365,brightness:1.6,saturation:.7},{key:'near',speed:.72,height:265,brightness:1.6,saturation:.7}];
 const brightCache=new WeakMap();
 function sourceFor(layer,img){
  if(!layer.brightness||typeof document==='undefined')return img;
  let source=brightCache.get(img);if(source)return source;
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
  const g=canvas.getContext?.('2d');if(!g)return img;
  g.filter=`brightness(${layer.brightness}) saturate(${layer.saturation||1})`;g.drawImage(img,0,0);g.filter='none';
  brightCache.set(img,canvas);return canvas;
 }
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
   const source=sourceFor(layer,img);
   const height=layer.height,width=Math.round(height*img.naturalWidth/img.naturalHeight);
   // Alternating forward/back tiles meet the identical source edge at every join.
   // Camera scale animates as the creature grows; it must not alter travel distance.
   for(const tile of tiles(camera+(layer.offset||0)/layer.speed,layer.speed,width,w)){ctx.save();ctx.translate(tile.x+(tile.flip?width:0),baseline-height);ctx.scale(tile.flip?-1:1,1);ctx.drawImage(source,0,0,width,height+2);ctx.restore();}
   if(layer.key==='far'){
    // Haze sits in front of the towers, behind the bridge and warehouses.
    // Put the bright part above the bridge deck; light at the baseline is hidden by it.
    const top=Math.max(0,baseline-370),bottom=baseline-95;
    const glow=ctx.createLinearGradient(0,top,0,bottom);
    glow.addColorStop(0,'#d9c1e400');
    glow.addColorStop(.35,'#efd1dc30');
    glow.addColorStop(.68,'#d8e1ec96');
    glow.addColorStop(1,'#d7e8efc0');
    ctx.fillStyle=glow;ctx.fillRect(0,top,w,bottom-top);
   }
  }
  ctx.restore();
 }
 return {layers,tiles,draw};
});
