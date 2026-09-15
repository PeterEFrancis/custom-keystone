import { homography, validQuad } from './geometry.js';
import { buildPatternLayout, parsePageSelection, visibleTiles, measurementScale } from './pattern-layout.js';
import { orientationBounds, projectPoint, unprojectPoint, composeOrientation, rotationOrientation, reflectionOrientation, calibratedPixelsPerMm } from './projector-math.js';
import { loadDocument } from './document-source.js';

const $ = id => document.getElementById(id);
const stage = $('stage'), frame = $('frame'), patternLayer = $('pattern-layer');
const IDENTITY = {a:1,b:0,c:0,d:1};
const SAVE_KEY = 'keystone-calibration-v2';
const calibration = {widthMm:609.6,heightMm:406.4,unit:'in',corners:[],confirmed:false,display:null};
let mode = 'calibrate', doc = null, layout = null, pageIndex = 0, layoutOptions = {mode:'single',pageIndex:0};
let pan = {x:0,y:0}, orientation = {...IDENTITY}, patternScale = 1, imageScale = 1;
let imageSizeConfirmed = false, pendingLaunchFile = null, exportController = null;
let viewMode = 'actual', overviewScale = 1, tool = 'pan', selectedCorner = 0, activePanel = null;
let marks = [], selectedMark = -1, draftMark = null, drag = null, color = 'normal';
let loadController = null, renderController = new AbortController(), loadVersion = 0, renderVersion = 0;
let renderRunning = false, renderDirty = false, cache = new Map(), tileNodes = new Map(), noticeTimer, resizeTimer;
let displayWarning = false, lastDisplay = displaySignature(), magnifyReturn = null, stitchDraft = null;
const cornerNames = ['Top left','Top right','Bottom right','Bottom left'];
const handleButtons = cornerNames.map((name,index) => {
  const button = document.createElement('button');
  button.className = 'corner-handle'; button.innerHTML = '<span>'+(index+1)+'</span>';
  button.setAttribute('aria-label',name+' calibration corner');
  button.addEventListener('pointerdown',event => {
    if(mode !== 'calibrate') return;
    event.preventDefault(); event.stopPropagation(); selectCorner(index);
    button.setPointerCapture(event.pointerId);
    drag = {type:'corner',index,pointerId:event.pointerId};
  });
  button.addEventListener('pointermove',event => {
    if(drag?.type === 'corner' && drag.pointerId === event.pointerId) moveCorner(index,event.clientX,event.clientY);
  });
  for(const eventName of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(eventName,()=>{if(drag?.type==='corner') drag=null;});
  button.addEventListener('keydown',event => {
    const direction = {ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];
    if(!direction) return; event.preventDefault(); event.stopPropagation(); selectCorner(index);
    nudgeCorner(direction[0],direction[1],event.shiftKey?10:1);
  });
  $('handles').append(button); return button;
});
function displaySignature(){return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio||1,fullscreen:!!document.fullscreenElement,x:screenX,y:screenY,screenWidth:screen.width,screenHeight:screen.height};}
function sameDisplay(a,b){return !!a&&Object.keys(b).every(key=>a[key]===b[key]);}
function unitFactor(){return calibration.unit==='in'?25.4:10;}
function formatLength(mm){return (mm/unitFactor()).toLocaleString(undefined,{maximumFractionDigits:2})+' '+calibration.unit;}
function rounded(value){return Math.round(value*10000)/10000;}
function notify(message,error=false,persistent=false){
  clearTimeout(noticeTimer); $('notice').textContent=message; $('notice').classList.toggle('error-notice',error);
  if(message&&!persistent) noticeTimer=setTimeout(()=>$('notice').textContent='',6500);
}
function selectCorner(index){selectedCorner=index;$('selected-corner').value=String(index);handleButtons.forEach((button,i)=>button.classList.toggle('selected',i===index));}
function initialCorners(){
  const width=innerWidth,height=innerHeight,availableWidth=Math.max(120,width-(width>650?390:70));
  const w=Math.min(availableWidth,Math.max(100,height-210)*calibration.widthMm/calibration.heightMm);
  const h=w*calibration.heightMm/calibration.widthMm;
  const x=width>650?(width-330-w)/2:(width-w)/2,y=Math.max(105,(height-h)/2);
  return [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
}
function saveCalibration(){
  try{localStorage.setItem(SAVE_KEY,JSON.stringify({...calibration,display:displaySignature()}));$('calibration-status').textContent='Calibration saved for this display.';}
  catch{$('calibration-status').textContent='Calibration is ready for this session.';}
}
function restoreCalibration(){
  try{
    const saved=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');
    if(saved&&['in','cm'].includes(saved.unit)&&Number.isFinite(saved.widthMm)&&Number.isFinite(saved.heightMm)&&saved.widthMm>=10&&saved.heightMm>=10&&saved.widthMm<=8000&&saved.heightMm<=8000&&validQuad(saved.corners)){
      calibration.widthMm=saved.widthMm;calibration.heightMm=saved.heightMm;calibration.unit=saved.unit;
      if(sameDisplay(saved.display,displaySignature())){calibration.corners=saved.corners;$('calibration-status').textContent='Saved grid restored. Check alignment, then continue.';}
      else{displayWarning=true;$('calibration-status').textContent='Your display changed. Set the grid for this display.';}
    }
  }catch{}
  if(!calibration.corners.length) calibration.corners=initialCorners();
  $('mat-width').value=rounded(calibration.widthMm/unitFactor());$('mat-height').value=rounded(calibration.heightMm/unitFactor());$('units').value=calibration.unit;
  updateUnitLabels();selectCorner(0);
}
function updateUnitLabels(){
  document.querySelectorAll('.unit-label').forEach(el=>el.textContent=calibration.unit);
  $('test-size').value=calibration.unit==='in'?4:10;$('known-length').value=calibration.unit==='in'?4:10;
}
function moveCorner(index,x,y){
  const next=calibration.corners.map(p=>({...p}));next[index]={x:Math.max(6,Math.min(innerWidth-6,x)),y:Math.max(6,Math.min(innerHeight-6,y))};
  if(validQuad(next)){calibration.corners=next;calibration.confirmed=false;drawFrame();}
}
function nudgeCorner(x,y,step=1){const p=calibration.corners[selectedCorner];moveCorner(selectedCorner,p.x+x*step,p.y+y*step);}
function drawFrame(){
  const {widthMm:w,heightMm:h,corners}=calibration;
  frame.style.width=w+'px';frame.style.height=h+'px';frame.style.transform='matrix3d('+homography(corners,w,h).join(',')+')';
  $('polygon').setAttribute('points',corners.map(p=>p.x+','+p.y).join(' '));
  handleButtons.forEach((button,i)=>{button.style.left=corners[i].x+'px';button.style.top=corners[i].y+'px';});
  $('handles').hidden=mode!=='calibrate';
  $('outline').toggleAttribute('hidden',mode==='project'&&!$('show-border').checked);
  drawGrid();drawOverlays();scheduleRender();
}
function drawGrid(){
  const svg=$('grid'),w=calibration.widthMm,h=calibration.heightMm,step=unitFactor();
  svg.setAttribute('viewBox','0 0 '+w+' '+h);svg.toggleAttribute('hidden',mode==='project'&&!$('show-grid').checked);
  let lines='';const minor=step/2;
  for(let x=0,i=0;x<=w+.001&&i<1600;x+=minor,i++) lines+='<path d="M'+x+' 0V'+h+'" stroke="currentColor" stroke-width="'+(i%2?.22:.5)+'" opacity="'+(i%2?.2:.48)+'"/>';
  for(let y=0,i=0;y<=h+.001&&i<1600;y+=minor,i++) lines+='<path d="M0 '+y+'H'+w+'" stroke="currentColor" stroke-width="'+(i%2?.22:.5)+'" opacity="'+(i%2?.2:.48)+'"/>';
  if(mode==='calibrate'){
    const font=Math.min(w,h)*.045;
    lines+='<path d="M0 0H'+w+'V'+h+'H0Z" stroke="currentColor" stroke-width="1"/>';
    lines+='<text x="'+w/2+'" y="'+h*.88+'" text-anchor="middle" fill="currentColor" stroke="none" font-size="'+font+'" font-family="system-ui">'+formatLength(w)+'</text>';
    lines+='<text x="'+w*.1+'" y="'+h/2+'" fill="currentColor" stroke="none" font-size="'+font+'" font-family="system-ui">'+formatLength(h)+'</text>';
    lines+='<path d="M'+(w/2-5)+' '+h/2+'h10M'+w/2+' '+(h/2-5)+'v10" stroke="currentColor" stroke-width="1"/>';
  }
  svg.innerHTML=lines;
}
function drawOverlays(){
  const svg=$('overlays'),w=calibration.widthMm,h=calibration.heightMm;svg.setAttribute('viewBox','0 0 '+w+' '+h);svg.toggleAttribute('hidden',mode!=='project');
  let content='';
  if($('show-fold').checked) content+='<path d="M'+w/2+' 0V'+h+'M0 '+h/2+'H'+w+'" stroke="#ffb965" stroke-width=".6" stroke-dasharray="4 3"/>';
  if($('show-wrong-side').checked) for(let y=12;y<h;y+=25.4) for(let x=12;x<w;x+=25.4) content+='<circle cx="'+x+'" cy="'+y+'" r=".7" fill="#ffb965" stroke="none"/>';
  const shape=$('test-shape').value,size=Number($('test-size').value)*unitFactor();
  if(shape!=='none'&&Number.isFinite(size)&&size>0){
    const tw=shape==='a4'?210:shape==='letter'?215.9:size,th=shape==='a4'?297:shape==='letter'?279.4:size;
    const x=(w-tw)/2,y=(h-th)/2;
    if(shape==='line') content+='<path d="M'+x+' '+h/2+'h'+tw+'M'+x+' '+(h/2-3)+'v6M'+(x+tw)+' '+(h/2-3)+'v6" stroke="currentColor" stroke-width=".7"/>';
    else content+='<rect x="'+x+'" y="'+y+'" width="'+tw+'" height="'+th+'" fill="none" stroke="currentColor" stroke-width=".7"/>';
    content+='<text x="'+w/2+'" y="'+(shape==='line'?h/2-6:y-5)+'" fill="currentColor" stroke="none" text-anchor="middle" font-size="5" font-family="system-ui">'+(shape==='a4'?'A4 · 210 × 297 mm':shape==='letter'?'Letter · 8.5 × 11 in':formatLength(size))+'</text>';
  }
  svg.innerHTML=content;
}
function setMode(next,writeHash=true){
  if(next==='project'&&!calibration.confirmed){next='calibrate';notify('Check the grid and choose Continue to pattern first.');}
  mode=next;document.body.dataset.mode=mode;
  $('calibration-panel').hidden=mode!=='calibrate';$('project-empty').hidden=mode!=='project'||!!doc;
  $('projection-toolbar').hidden=mode!=='project';$('view-controls').hidden=mode!=='project'||!doc;
  $('document-navigation').hidden=mode!=='project'||!doc||doc.pages.length<2;
  patternLayer.hidden=mode!=='project'||!doc;$('tool-panel').hidden=mode!=='project'||!doc||!activePanel;
  $('calibrate-nav').setAttribute('aria-current',mode==='calibrate'?'step':'false');$('project-nav').setAttribute('aria-current',mode==='project'?'step':'false');
  $('display-warning').hidden=!displayWarning;setTool('pan');drawFrame();updateStatus();
  if(writeHash&&location.hash!=='#/'+mode) location.hash='/'+mode;
}
function bounds(){return orientationBounds(layout.width,layout.height,orientation);}
function actualScale(){return patternScale*imageScale;}
function effectiveScale(){return viewMode==='overview'?overviewScale:actualScale()*(viewMode==='magnify'?2:1);}
function toMat(point){return projectPoint(point,orientation,bounds(),pan,effectiveScale());}
function toPattern(point){return unprojectPoint(point,orientation,bounds(),pan,effectiveScale());}
function screenToMat(x,y){const inverse=new DOMMatrix(frame.style.transform).inverse(),p=new DOMPoint(x,y,0,1).matrixTransform(inverse);return {x:p.x/p.w,y:p.y/p.w};}
function centerPattern(){
  if(!layout)return;const b=bounds(),s=effectiveScale();pan={x:(calibration.widthMm-b.width*s)/2,y:(calibration.heightMm-b.height*s)/2};drawPattern();
}
function drawPattern(){
  if(!layout)return;const b=bounds(),s=effectiveScale();
  patternLayer.style.width=layout.width+'px';patternLayer.style.height=layout.height+'px';
  patternLayer.style.transform='matrix('+[orientation.a*s,orientation.b*s,orientation.c*s,orientation.d*s,pan.x-b.minX*s,pan.y-b.minY*s].join(',')+')';
  drawMarks();updateStatus();scheduleRender();
}
function setScale(next,anchor={x:calibration.widthMm/2,y:calibration.heightMm/2}){
  if(!doc||!Number.isFinite(next)||next<.01||next>10)throw new Error('Choose a pattern scale between 1% and 1000%.');
  const source=toPattern(anchor);viewMode='actual';patternScale=next;const after=toMat(source);pan.x+=anchor.x-after.x;pan.y+=anchor.y-after.y;drawPattern();
}
function changeOrientation(next,source=layout?{x:layout.width/2,y:layout.height/2}:null,anchor=null){
  if(!layout)return;anchor??=toMat(source);orientation=next;const after=toMat(source);pan.x+=anchor.x-after.x;pan.y+=anchor.y-after.y;
  if(viewMode==='overview')fitOverview();else drawPattern();
}
function fitOverview(){if(!layout)return;viewMode='overview';const b=bounds();overviewScale=Math.min(calibration.widthMm/b.width,calibration.heightMm/b.height)*.92;centerPattern();}
function returnToActual(anchor={x:calibration.widthMm/2,y:calibration.heightMm/2},centerAtClick=false){
  if(!layout)return;const source=toPattern(anchor);viewMode='actual';const target=centerAtClick?{x:calibration.widthMm/2,y:calibration.heightMm/2}:anchor;const after=toMat(source);pan.x+=target.x-after.x;pan.y+=target.y-after.y;drawPattern();
}
function updateStatus(){
  $('workspace-hint').textContent=mode==='calibrate'?'Drag the four corners to match your mat':!doc?'Calibration locked · Open your pattern':viewMode==='overview'?'Overview · Click a point to return to scale':viewMode==='magnify'?'Magnified ×2 · Click again to return':tool==='line'?'Drag over a known length in your pattern':tool==='square'?'Drag around a printed test square':imageSizeConfirmed?'Drag to move · Scroll to pan':'Image print size needs a check · Use Scale';
  $('scale-status').textContent=viewMode==='overview'?'Overview':viewMode==='magnify'?'×2 view':(Math.round(patternScale*1000)/10)+'%';
  $('pattern-scale').value=rounded(patternScale*100);
  document.body.classList.toggle('scale-changed',Math.abs(patternScale-1)>.0001||viewMode!=='actual');
  $('overview').setAttribute('aria-pressed',String(viewMode==='overview'));$('magnify').setAttribute('aria-pressed',String(tool==='magnify'||viewMode==='magnify'));
  $('page-number').value=pageIndex+1;$('page-count').textContent='/ '+(doc?.pages.length||1);
  $('previous-page').disabled=!doc||pageIndex<=0||layoutOptions.mode!=='single';$('next-page').disabled=!doc||pageIndex>=(doc?.pages.length||1)-1||layoutOptions.mode!=='single';
  $('page-number').disabled=layoutOptions.mode!=='single';$('layout-mode').value=layoutOptions.mode;
  $('export-pdf').disabled=!doc||layoutOptions.mode!=='stitch'||!!exportController;
  document.querySelectorAll('#projection-toolbar button:not(#open)').forEach(button=>button.disabled=!doc);
  $('stitch-panel-button').disabled=!doc||doc.pages.length<2;
}

function clearCache(){
  if(exportController){exportController.abort();notify('Pattern changed. Export again with the new document or layers.');}
  renderVersion++;renderController.abort();renderController=new AbortController();
  for(const entry of cache.values()){entry.canvas.width=0;entry.canvas.height=0;}cache.clear();
  for(const node of tileNodes.values()){for(const canvas of node.querySelectorAll('canvas')){canvas.width=0;canvas.height=0;}node.replaceChildren();node.dataset.renderKey='';}
}
function installLayout(next,options,{clearMarks=true,preserveView=false}={}){
  const previousBounds=preserveView&&layout?bounds():null;
  // Overlap changes move existing pages; keep their canvases and the view steady.
  const reuseTiles=preserveView&&layout&&layout.tiles.length===next.tiles.length&&next.tiles.every((tile,index)=>{
    const previous=layout.tiles[index];
    return tile.id===previous.id&&tile.pageIndex===previous.pageIndex&&tile.width===previous.width&&tile.height===previous.height&&tile.crop.left===previous.crop.left&&tile.crop.top===previous.crop.top;
  });
  layout=next;layoutOptions={...options};pageIndex=options.pageIndex??pageIndex;
  if(!reuseTiles){
    for(const node of tileNodes.values())for(const canvas of node.querySelectorAll('canvas')){canvas.width=0;canvas.height=0;}
    tileNodes.clear();$('tiles').replaceChildren();
  }
  for(const tile of layout.tiles){
    const node=reuseTiles?tileNodes.get(tile.id):document.createElement('div');node.className='tile';node.style.left=tile.x+'px';node.style.top=tile.y+'px';node.style.width=tile.width+'px';node.style.height=tile.height+'px';
    node.setAttribute('aria-label',tile.pageIndex<0?'Blank page':'Pattern page '+(tile.pageIndex+1));
    if(!reuseTiles){$('tiles').append(node);tileNodes.set(tile.id,node);}
  }
  if(clearMarks){marks=[];selectedMark=-1;draftMark=null;}
  if(previousBounds){
    const nextBounds=bounds(),dx=nextBounds.minX-previousBounds.minX,dy=nextBounds.minY-previousBounds.minY;
    pan.x+=dx*effectiveScale();pan.y+=dy*effectiveScale();
    if(magnifyReturn){magnifyReturn.x+=dx*actualScale();magnifyReturn.y+=dy*actualScale();}
    drawPattern();
  }else if(viewMode==='overview')fitOverview();else centerPattern();
  updateMeasurement();
}
async function openFile(file){
  if(!file)return;
  if(mode!=='project'||!calibration.confirmed){notify('Finish calibrating your mat before opening a pattern.');return;}
  const version=++loadVersion;loadController?.abort();loadController=new AbortController();
  notify('Opening '+file.name+'…',false,true);stage.setAttribute('aria-busy','true');
  try{
    const next=await loadDocument(file,{signal:loadController.signal,onPassword:askPassword,onProgress:progress=>{
      if(version===loadVersion&&progress.phase==='metadata'&&progress.total>20)notify('Reading pages '+progress.loaded+' / '+progress.total+'…',false,true);
    }});
    if(version!==loadVersion){next.dispose();return;}
    const initialLayout=buildPatternLayout(next.pages,{mode:'single',pageIndex:0});
    exportController?.abort();clearCache();const previous=doc;doc=next;previous?.dispose();imageSizeConfirmed=doc.physicalScaleKnown;
    patternScale=1;imageScale=1;orientation={...IDENTITY};viewMode='actual';pageIndex=0;activePanel=null;
    $('file-name').textContent=doc.name;$('open').title='Replace '+doc.name;
    $('page-number').max=doc.pages.length;$('image-size-section').hidden=doc.type==='pdf';
    $('image-width').value=rounded(doc.pages[0].widthMm/unitFactor());
    $('page-selection').value='1-'+doc.pages.length;$('stitch-columns').value=Math.min(2,doc.pages.length);
    $('stitch-rows').value=Math.ceil(doc.pages.length/Number($('stitch-columns').value));
    for(const id of ['trim-top','trim-bottom','trim-left','trim-right','overlap-x','overlap-y'])$(id).value=0;
    installLayout(initialLayout,{mode:'single',pageIndex:0});refreshLayers();previewStitch();setMode('project',false);
    notify(doc.physicalScaleKnown?'Pattern opened at its native print size.':'Image opened. Use Scale to set a known width or measure its test square.');
    if(!doc.physicalScaleKnown)showPanel('scale');
  }catch(error){if(version===loadVersion&&error.name!=='AbortError')notify(error.message||'Unable to open this file.',true);}
  finally{if(version===loadVersion){loadController=null;stage.setAttribute('aria-busy','false');}}
}
function askPassword(reason){
  return new Promise(resolve=>{
    const dialog=$('password-dialog');$('password-help').textContent=reason===2?'That password did not work. Try again.':'Enter this PDF’s password.';$('pdf-password').value='';
    dialog.addEventListener('close',()=>resolve(dialog.returnValue==='unlock'?$('pdf-password').value:null),{once:true});dialog.showModal();$('pdf-password').focus();
  });
}
function scheduleRender(){
  if(!doc||!layout||mode!=='project')return;
  renderDirty=true;if(renderRunning)return;renderRunning=true;
  requestAnimationFrame(async()=>{
    try{while(renderDirty){renderDirty=false;await renderVisible();}}
    catch(error){if(error.name!=='AbortError')notify('A page could not be rendered. Try reopening the file.',true);}
    finally{renderRunning=false;}
  });
}
async function renderVisible(){
  const source=doc,version=renderVersion,signal=renderController.signal,currentLayout=layout;
  if(!source||!currentLayout||mode!=='project')return;
  const corners=[{x:0,y:0},{x:calibration.widthMm,y:0},{x:calibration.widthMm,y:calibration.heightMm},{x:0,y:calibration.heightMm}].map(toPattern);
  const minX=Math.min(...corners.map(p=>p.x)),minY=Math.min(...corners.map(p=>p.y));
  const visible=visibleTiles(currentLayout,{x:minX,y:minY,width:Math.max(...corners.map(p=>p.x))-minX,height:Math.max(...corners.map(p=>p.y))-minY},12/effectiveScale());
  const visibleIds=new Set(visible.map(tile=>tile.id));
  for(const [id,node] of tileNodes){if(!visibleIds.has(id)&&node.childElementCount){for(const canvas of node.querySelectorAll('canvas')){canvas.width=0;canvas.height=0;}node.replaceChildren();node.dataset.renderKey='';}}
  const desired=Math.max(.2,Math.min(16,Math.ceil(effectiveScale()*calibratedPixelsPerMm(calibration.corners,calibration.widthMm,calibration.heightMm)*Math.min(devicePixelRatio||1,2)*2)/2));
  for(const tile of visible){
    if(source!==doc||currentLayout!==layout||signal.aborted||mode!=='project')break;
    if(tile.pageIndex<0)continue;
    let entry=cache.get(tile.pageIndex);
    if(!entry||entry.density<desired||entry.version!==version){
      let canvas;
      try{canvas=await source.renderPage(tile.pageIndex,{pixelsPerMm:desired,signal});}
      catch(error){if(error.name==='AbortError'||source!==doc)break;notify('Page '+(tile.pageIndex+1)+' could not be displayed.',true);continue;}
      if(source!==doc||currentLayout!==layout||version!==renderVersion||signal.aborted){canvas.width=0;canvas.height=0;break;}
      if(entry){entry.canvas.width=0;entry.canvas.height=0;}
      entry={canvas,density:desired,version,last:performance.now()};cache.set(tile.pageIndex,entry);
    }
    entry.last=performance.now();const node=tileNodes.get(tile.id),key=version+':'+tile.pageIndex+':'+entry.density;
    if(node&&node.dataset.renderKey!==key){
      for(const old of node.querySelectorAll('canvas')){old.width=0;old.height=0;}
      const canvas=document.createElement('canvas');canvas.width=entry.canvas.width;canvas.height=entry.canvas.height;canvas.getContext('2d').drawImage(entry.canvas,0,0);
      canvas.style.width=tile.pageWidth+'px';canvas.style.height=tile.pageHeight+'px';canvas.style.left=-tile.crop.left+'px';canvas.style.top=-tile.crop.top+'px';
      canvas.setAttribute('role','img');canvas.setAttribute('aria-label','PDF or image page '+(tile.pageIndex+1));node.replaceChildren(canvas);node.dataset.renderKey=key;
    }
    let pixels=[...cache.values()].reduce((sum,value)=>sum+value.canvas.width*value.canvas.height,0);
    for(const [index,value] of [...cache.entries()].sort((a,b)=>a[1].last-b[1].last)){
      if(cache.size<=10&&pixels<=18000000)break;if(index===tile.pageIndex)continue;
      pixels-=value.canvas.width*value.canvas.height;value.canvas.width=0;value.canvas.height=0;cache.delete(index);
    }
    if(renderDirty)break;
  }
}
function showPanel(name){
  if(!doc)return;activePanel=name;
  $('tool-panel').hidden=!name||mode!=='project';
  const titles={view:'Projection view',stitch:'Stitch pages',layers:'Pattern layers',scale:'Scale & measure'};
  if(name)$('panel-title').textContent=titles[name];
  for(const key of Object.keys(titles))$('panel-'+key).hidden=key!==name;
  for(const key of ['view','stitch','layers','scale'])$(key+'-panel-button').setAttribute('aria-pressed',String(key===name));
  if(name==='stitch')previewStitch();
}
function refreshLayers(){
  const list=$('layers-list');list.replaceChildren();
  if(!doc?.layers.length){const text=document.createElement('p');text.className='layer-empty';text.textContent='This file has no optional layers.';list.append(text);}
  for(const layer of doc?.layers||[]){
    const label=document.createElement('label');label.className='check layer-label';const input=document.createElement('input');input.type='checkbox';input.checked=layer.visible;
    const span=document.createElement('span');span.textContent=layer.name;label.append(input,span);list.append(label);
    input.addEventListener('change',async()=>{try{await doc.setLayerVisible(layer.id,input.checked);clearCache();refreshLayers();scheduleRender();}catch(error){notify(error.message,true);}});
  }
  $('layers-all').disabled=$('layers-none').disabled=!doc?.layers.length;
}
function readStitchOptions(){
  const mm=id=>$(id).valueAsNumber*unitFactor();
  return {mode:'stitch',selection:$('page-selection').value,columns:Number($('stitch-columns').value),rows:Number($('stitch-rows').value),order:$('stitch-order').value,trim:{top:mm('trim-top'),right:mm('trim-right'),bottom:mm('trim-bottom'),left:mm('trim-left')},overlapX:mm('overlap-x'),overlapY:mm('overlap-y')};
}
function previewStitch(){
  if(!doc)return;
  try{
    const options=readStitchOptions(),preview=buildPatternLayout(doc.pages,options);stitchDraft={options,layout:preview};
    $('stitch-rows').value=preview.rows;$('stitch-error').textContent='';
    $('stitch-summary').textContent=preview.tiles.length+' pages · '+formatLength(preview.width*actualScale())+' × '+formatLength(preview.height*actualScale());
    const font=Math.max(preview.width,preview.height)*.04;
    $('stitch-preview').innerHTML='<svg viewBox="-5 -5 '+(preview.width+10)+' '+(preview.height+10)+'">'+preview.tiles.map(tile=>'<rect x="'+tile.x+'" y="'+tile.y+'" width="'+tile.width+'" height="'+tile.height+'" fill="'+(tile.pageIndex<0?'#172027':'#33434c')+'" stroke="#6de9bd" stroke-width="'+font*.045+'"/><text x="'+(tile.x+tile.width/2)+'" y="'+(tile.y+tile.height/2)+'" text-anchor="middle" dominant-baseline="central" font-size="'+font+'">'+(tile.pageIndex<0?'—':tile.pageIndex+1)+'</text>').join('')+'</svg>';
  }catch(error){stitchDraft=null;$('stitch-error').textContent=error.message;$('stitch-preview').replaceChildren();$('stitch-summary').textContent='';}
}
function currentMark(){return marks[selectedMark]||null;}
function markMidpoint(mark){return {x:(mark.x1+mark.x2)/2,y:(mark.y1+mark.y2)/2};}
function markLength(mark){return mark.type==='square'?(Math.abs(mark.x2-mark.x1)+Math.abs(mark.y2-mark.y1))/2:Math.hypot(mark.x2-mark.x1,mark.y2-mark.y1);}
function drawMarks(){
  if(!layout)return;const svg=$('marks');svg.setAttribute('viewBox','0 0 '+layout.width+' '+layout.height);
  const stroke=Math.max(.2,1/effectiveScale());
  svg.innerHTML=[...marks,...(draftMark?[draftMark]:[])].map((mark,index)=>{
    const attrs=' fill="none" stroke="'+(index===selectedMark?'#ffba63':'#fd82cf')+'" stroke-width="'+stroke+'"';
    return (mark.type==='square'?'<rect x="'+Math.min(mark.x1,mark.x2)+'" y="'+Math.min(mark.y1,mark.y2)+'" width="'+Math.abs(mark.x2-mark.x1)+'" height="'+Math.abs(mark.y2-mark.y1)+'"'+attrs+'/>':'<path d="M'+mark.x1+' '+mark.y1+'L'+mark.x2+' '+mark.y2+'"'+attrs+'/>')+'<circle cx="'+mark.x1+'" cy="'+mark.y1+'" r="'+stroke*2+'" fill="#ffba63" stroke="none"/>';
  }).join('');
}
function updateMeasurement(){
  const mark=currentMark();$('apply-measurement').disabled=!mark;$('mark-actions').hidden=!mark;$('measurement-error').textContent='';
  $('measurement-readout').textContent=mark?(mark.type==='square'?'Square side: ':'Line length: ')+formatLength(markLength(mark)*actualScale())+' · mark '+(selectedMark+1)+' / '+marks.length:'No measurement selected';
  for(const id of ['align-mark','flip-mark','move-mark'])$(id).disabled=!mark||mark.type==='square';
  if(layout)drawMarks();
}
function applyMeasuredScale(){
  const mark=currentMark();if(!mark)return;
  try{
    if(mark.type==='square'){
      const w=Math.abs(mark.x2-mark.x1),h=Math.abs(mark.y2-mark.y1);
      if(Math.abs(w-h)/Math.max(w,h)>.08)throw new Error('That selection is not square. Redraw its edges, or use a known line.');
    }
    const desired=Number($('known-length').value)*unitFactor(),next=measurementScale(markLength(mark)*imageScale,desired);
    setScale(next);imageSizeConfirmed=true;updateStatus();updateMeasurement();notify('Pattern scaled so the selected '+(mark.type==='square'?'square side':'line')+' measures '+formatLength(desired)+'.');
  }catch(error){$('measurement-error').textContent=error.message;}
}
function setTool(next){tool=next;document.body.dataset.tool=next;$('pan-tool').setAttribute('aria-pressed',String(next==='pan'));$('measure-tool').setAttribute('aria-pressed',String(next==='line'||next==='square'));updateStatus();}
function updateColors(next){
  color=next;document.body.dataset.color=color;$('colors').value=color;$('color-name').textContent={normal:'Original',white:'White',green:'Green'}[color];
  document.documentElement.style.setProperty('--paper',color==='normal'?'#fff':'#000');
  const weight=Number($('line-weight').value);$('ink-radius').setAttribute('radius',weight);
  document.documentElement.style.setProperty('--ink-filter',(weight?'url(#thick-ink) ':'')+(color==='white'?'grayscale(1) invert(1)':color==='green'?'url(#green-ink)':weight?'':'none'));
}

stage.addEventListener('pointerdown',event=>{
  if(mode!=='project'||!doc||event.target.closest('.corner-handle')||drag)return;
  if(event.button!==0)return;
  event.preventDefault();stage.focus({preventScroll:true});
  const point=screenToMat(event.clientX,event.clientY);if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return;
  if(viewMode==='overview'){returnToActual(point,true);return;}
  if(tool==='magnify'){
    if(viewMode==='magnify'){viewMode='actual';pan=magnifyReturn||pan;magnifyReturn=null;drawPattern();}
    else{const source=toPattern(point);magnifyReturn={...pan};viewMode='magnify';const after=toMat(source);pan.x+=point.x-after.x;pan.y+=point.y-after.y;drawPattern();}
    return;
  }
  stage.setPointerCapture(event.pointerId);document.body.classList.add('dragging');
  if(tool==='line'||tool==='square'){
    const p=toPattern(point);draftMark={type:tool,x1:p.x,y1:p.y,x2:p.x,y2:p.y};drag={type:'mark',pointerId:event.pointerId};drawMarks();
  }else drag={type:'pan',pointerId:event.pointerId,point,pan:{...pan}};
});
stage.addEventListener('pointermove',event=>{
  if(!drag||drag.pointerId!==event.pointerId||drag.type==='corner')return;
  const point=screenToMat(event.clientX,event.clientY);
  if(drag.type==='pan'){pan={x:drag.pan.x+point.x-drag.point.x,y:drag.pan.y+point.y-drag.point.y};drawPattern();}
  else if(draftMark){const p=toPattern(point);draftMark.x2=p.x;draftMark.y2=p.y;drawMarks();}
});
function releaseDrag(event){
  if(!drag||drag.pointerId!==event.pointerId||drag.type==='corner')return;
  if(drag.type==='mark'&&draftMark){
    if(event.type==='pointerup'&&markLength(draftMark)*effectiveScale()>.5){marks.push(draftMark);if(marks.length>100)marks.shift();selectedMark=marks.length-1;showPanel('scale');}
    draftMark=null;updateMeasurement();setTool('pan');
  }
  drag=null;document.body.classList.remove('dragging');
}
for(const name of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(name,releaseDrag);
stage.addEventListener('wheel',event=>{
  if(mode!=='project'||!doc)return;event.preventDefault();const anchor=screenToMat(event.clientX,event.clientY);
  if(event.ctrlKey||event.metaKey){setScale(Math.max(.01,Math.min(10,patternScale*Math.exp(-event.deltaY*.002))),anchor);updateMeasurement();return;}
  const multiplier=event.deltaMode===1?16:event.deltaMode===2?innerHeight:1;
  const dx=(event.shiftKey&&!event.deltaX?event.deltaY:event.deltaX)*multiplier,dy=(event.shiftKey&&!event.deltaX?0:event.deltaY)*multiplier;
  const shifted=screenToMat(event.clientX-dx,event.clientY-dy);pan.x+=shifted.x-anchor.x;pan.y+=shifted.y-anchor.y;drawPattern();
},{passive:false});
$('calibration-form').addEventListener('submit',event=>{
  event.preventDefault();if(!$('calibration-form').reportValidity())return;
  const w=Number($('mat-width').value)*unitFactor(),h=Number($('mat-height').value)*unitFactor();
  if(!Number.isFinite(w)||!Number.isFinite(h)||w<10||h<10||w>8000||h>8000){notify('Enter mat dimensions between 1 and 300 in your chosen units.',true);return;}
  if(!validQuad(calibration.corners)||calibration.corners.some(p=>p.x<0||p.y<0||p.x>innerWidth||p.y>innerHeight)){notify('Keep all four corners inside the screen. Reset the rectangle if necessary.',true);return;}
  calibration.widthMm=w;calibration.heightMm=h;calibration.confirmed=true;calibration.display=displaySignature();displayWarning=false;lastDisplay=displaySignature();saveCalibration();setMode('project');
  if(pendingLaunchFile){const file=pendingLaunchFile;pendingLaunchFile=null;void openFile(file);}
});
for(const id of ['mat-width','mat-height'])$(id).addEventListener('change',()=>{
  const w=Number($('mat-width').value)*unitFactor(),h=Number($('mat-height').value)*unitFactor();
  if(w>=10&&h>=10&&w<=8000&&h<=8000){calibration.widthMm=w;calibration.heightMm=h;calibration.confirmed=false;drawFrame();}
});
$('units').addEventListener('change',()=>{
  const old=unitFactor();calibration.unit=$('units').value;const factor=old/unitFactor();
  for(const id of ['test-size','known-length','image-width','trim-top','trim-bottom','trim-left','trim-right','overlap-x','overlap-y']){if($(id).value)$(id).value=rounded(Number($(id).value)*factor);}
  $('mat-width').value=rounded(calibration.widthMm/unitFactor());$('mat-height').value=rounded(calibration.heightMm/unitFactor());
  document.querySelectorAll('.unit-label').forEach(el=>el.textContent=calibration.unit);drawFrame();updateMeasurement();
});
$('reset-calibration').addEventListener('click',()=>{calibration.corners=initialCorners();calibration.confirmed=false;drawFrame();});
$('selected-corner').addEventListener('change',()=>selectCorner(Number($('selected-corner').value)));
$('next-corner').addEventListener('click',()=>selectCorner((selectedCorner+1)%4));
document.querySelectorAll('[data-nudge]').forEach(button=>button.addEventListener('click',()=>{const [x,y]=button.dataset.nudge.split(',').map(Number);nudgeCorner(x,y);}));
$('calibrate-nav').addEventListener('click',()=>setMode('calibrate'));
$('project-nav').addEventListener('click',()=>setMode('project'));
window.addEventListener('hashchange',()=>setMode(location.hash==='#/project'?'project':'calibrate',false));
for(const id of ['open','open-empty'])$(id).addEventListener('click',()=>{if(mode==='project')$('file-input').click();});
$('file-input').addEventListener('change',event=>{void openFile(event.target.files[0]);event.target.value='';});
let dragDepth=0;
document.addEventListener('dragenter',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dragDepth++;document.body.classList.add('drag-over');}});
document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect=mode==='project'?'copy':'none';}});
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('drag-over');}});
document.addEventListener('drop',event=>{event.preventDefault();dragDepth=0;document.body.classList.remove('drag-over');void openFile(event.dataTransfer?.files[0]);});
$('pan-tool').addEventListener('click',()=>setTool('pan'));
$('measure-tool').addEventListener('click',()=>{showPanel('scale');setTool('line');});
$('draw-line').addEventListener('click',()=>{setTool('line');notify('Drag along a known test line in the pattern.');});
$('draw-square').addEventListener('click',()=>{setTool('square');notify('Drag from one corner of the test square to its opposite corner.');});
$('apply-measurement').addEventListener('click',applyMeasuredScale);
$('rotate').addEventListener('click',()=>changeOrientation(composeOrientation(rotationOrientation(90),orientation)));
$('flip-h').addEventListener('click',()=>changeOrientation(composeOrientation({a:-1,b:0,c:0,d:1},orientation)));
$('flip-v').addEventListener('click',()=>changeOrientation(composeOrientation({a:1,b:0,c:0,d:-1},orientation)));
$('reset-orientation').addEventListener('click',()=>{changeOrientation({...IDENTITY});centerPattern();});
$('center').addEventListener('click',centerPattern);
$('overview').addEventListener('click',()=>viewMode==='overview'?returnToActual():fitOverview());
$('magnify').addEventListener('click',()=>{if(viewMode==='magnify'){viewMode='actual';pan=magnifyReturn||pan;drawPattern();setTool('pan');}else{setTool(tool==='magnify'?'pan':'magnify');if(tool==='magnify')notify('Click a point in the pattern to magnify it.');}});
$('zoom-in').addEventListener('click',()=>{setScale(Math.min(10,patternScale+.1));updateMeasurement();});
$('zoom-out').addEventListener('click',()=>{setScale(Math.max(.01,patternScale-.1));updateMeasurement();});
$('pattern-scale').addEventListener('change',()=>{try{setScale(Number($('pattern-scale').value)/100);updateMeasurement();}catch(error){notify(error.message,true);updateStatus();}});
$('actual-size').addEventListener('click',()=>{setScale(1);updateMeasurement();});
$('image-width').addEventListener('change',()=>{
  if(!doc)return;const mm=Number($('image-width').value)*unitFactor();if(!Number.isFinite(mm)||mm<=0||mm>20000){notify('Enter a positive image width below 20 metres.',true);return;}
  imageScale=mm/doc.pages[0].widthMm;imageSizeConfirmed=true;viewMode='actual';centerPattern();updateMeasurement();
});
$('colors').addEventListener('change',()=>updateColors($('colors').value));
$('line-weight').addEventListener('change',()=>updateColors(color));
$('invert').addEventListener('click',()=>{const colors=['normal','green','white'];updateColors(colors[(colors.indexOf(color)+1)%3]);});
for(const id of ['show-grid','show-border','show-fold','show-wrong-side','test-shape','test-size'])$(id).addEventListener('change',()=>{drawFrame();$('test-size-label').hidden=!['square','line'].includes($('test-shape').value);});
document.querySelectorAll('[data-panel]').forEach(button=>button.addEventListener('click',()=>showPanel(activePanel===button.dataset.panel?null:button.dataset.panel)));
$('close-panel').addEventListener('click',()=>showPanel(null));
for(const [id,visible] of [['layers-all',true],['layers-none',false]])$(id).addEventListener('click',async()=>{
  if(!doc)return;try{for(const layer of doc.layers)await doc.setLayerVisible(layer.id,visible);clearCache();refreshLayers();scheduleRender();}catch(error){notify(error.message,true);}
});
function updateStitchDraft(event){
  try{
    const id=event.target.id,count=parsePageSelection($('page-selection').value,doc.pages.length).length;
    if(id==='stitch-rows'){const rows=Number($('stitch-rows').value);if(Number.isSafeInteger(rows)&&rows>0)$('stitch-columns').value=Math.max(1,Math.ceil(count/rows));}
    if(id==='stitch-columns'||id==='page-selection'){const columns=Number($('stitch-columns').value);if(Number.isSafeInteger(columns)&&columns>0)$('stitch-rows').value=Math.max(1,Math.ceil(count/columns));}
  }catch{}
  previewStitch();
  if(['overlap-x','overlap-y'].includes(event.target.id)&&stitchDraft&&JSON.stringify(layoutOptions)!==JSON.stringify(stitchDraft.options)){
    if(exportController){exportController.abort();notify('Overlap changed. Export again with the new layout.');}
    installLayout(stitchDraft.layout,stitchDraft.options,{preserveView:layoutOptions.mode==='stitch'});
  }
}
$('stitch-form').addEventListener('input',updateStitchDraft);$('stitch-form').addEventListener('change',updateStitchDraft);
$('stitch-form').addEventListener('submit',event=>{event.preventDefault();previewStitch();if(!stitchDraft)return;installLayout(stitchDraft.layout,stitchDraft.options);notify('Pages stitched at their original scale. Measurement marks have been cleared.');});
$('unstitch').addEventListener('click',()=>{if(doc)installLayout(buildPatternLayout(doc.pages,{mode:'single',pageIndex:0}),{mode:'single',pageIndex:0});});
function goToPage(index){if(!doc||!Number.isSafeInteger(index)||index<0||index>=doc.pages.length)return;installLayout(buildPatternLayout(doc.pages,{mode:'single',pageIndex:index}),{mode:'single',pageIndex:index});}
$('previous-page').addEventListener('click',()=>goToPage(pageIndex-1));$('next-page').addEventListener('click',()=>goToPage(pageIndex+1));
$('page-number').addEventListener('change',()=>{goToPage(Number($('page-number').value)-1);updateStatus();});
$('layout-mode').addEventListener('change',()=>{if(!doc)return;const next=$('layout-mode').value;if(next==='stitch'){showPanel('stitch');return;}const options={mode:next,pageIndex};installLayout(buildPatternLayout(doc.pages,options),options);});
$('export-pdf').addEventListener('click',async()=>{
  if(!doc||!layout||exportController)return;const source=doc,exportLayout=layout,scale=actualScale();exportController=new AbortController();const signal=exportController.signal;$('export-pdf').disabled=true;notify('Preparing stitched PDF…',false,true);
  try{
    const {exportPatternPdf}=await import('./export-pattern.js');const blob=await exportPatternPdf(source,exportLayout,{scale,signal,name:source.name.replace(/\.[^.]+$/,'')+'-stitched.pdf'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=blob.exportInfo.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    notify('Stitched PDF downloaded.'+(blob.exportInfo.mode!=='vector'?' Visible layers were flattened into the export.':''));
  }catch(error){if(error.name!=='AbortError')notify('Export failed: '+error.message,true);}
  finally{exportController=null;updateStatus();}
});
function chooseMark(delta){if(!marks.length)return;selectedMark=(selectedMark+delta+marks.length)%marks.length;updateMeasurement();centerSelectedMark();}
function centerSelectedMark(){const mark=currentMark();if(!mark)return;const point=toMat(markMidpoint(mark));pan.x+=calibration.widthMm/2-point.x;pan.y+=calibration.heightMm/2-point.y;drawPattern();}
$('previous-mark').addEventListener('click',()=>chooseMark(-1));$('next-mark').addEventListener('click',()=>chooseMark(1));$('center-mark').addEventListener('click',centerSelectedMark);
$('delete-mark').addEventListener('click',()=>{if(selectedMark>=0)marks.splice(selectedMark,1);selectedMark=Math.min(selectedMark,marks.length-1);updateMeasurement();});
$('align-mark').addEventListener('click',()=>{
  const mark=currentMark();if(!mark||mark.type!=='line')return;const p1=toMat({x:mark.x1,y:mark.y1}),p2=toMat({x:mark.x2,y:mark.y2});
  const angle=-Math.atan2(p2.y-p1.y,p2.x-p1.x)*180/Math.PI;changeOrientation(composeOrientation(rotationOrientation(angle),orientation),markMidpoint(mark),{x:calibration.widthMm/2,y:calibration.heightMm/2});
});
$('flip-mark').addEventListener('click',()=>{const mark=currentMark();if(!mark||mark.type!=='line')return;changeOrientation(composeOrientation(orientation,reflectionOrientation({x:mark.x1,y:mark.y1},{x:mark.x2,y:mark.y2})),markMidpoint(mark));});
$('move-mark').addEventListener('click',()=>{const mark=currentMark();if(!mark||mark.type!=='line')return;const p1=toMat({x:mark.x1,y:mark.y1}),p2=toMat({x:mark.x2,y:mark.y2});pan.x+=p2.x-p1.x;pan.y+=p2.y-p1.y;drawPattern();});
function showControls(show){document.body.classList.toggle('controls-hidden',!show);$('show-menu').hidden=show;}
$('hide-menu').addEventListener('click',()=>showControls(false));$('show-menu').addEventListener('click',()=>showControls(true));
async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('Fullscreen is unavailable here. Open Keystone in a browser window to use it.',true);}}
$('fullscreen').addEventListener('click',fullscreen);
$('help-button').addEventListener('click',()=>$('help-dialog').showModal());$('close-help').addEventListener('click',()=>$('help-dialog').close());
function checkDisplay(){
  const next=displaySignature();if(sameDisplay(lastDisplay,next))return;lastDisplay=next;
  clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{
    calibration.confirmed=false;displayWarning=true;showControls(true);setMode('calibrate');
    $('calibration-status').textContent='Display size changed. Check the grid, or reset the rectangle.';
    $('fullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen');
  },180);
}
window.addEventListener('resize',checkDisplay);document.addEventListener('fullscreenchange',checkDisplay);setInterval(checkDisplay,1000);
window.addEventListener('keydown',event=>{
  const editing=event.target.closest('input,select,textarea,[contenteditable=true]');
  if(event.key==='Escape'){showControls(true);setTool('pan');if(activePanel)showPanel(null);return;}
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='o'){event.preventDefault();if(mode==='project')$('file-input').click();else notify('Continue from calibration before opening a pattern.');return;}
  if(editing||document.querySelector('dialog[open]'))return;
  if(event.key==='Tab'&&(event.target===stage||event.target===document.body)){event.preventDefault();showControls(document.body.classList.contains('controls-hidden'));return;}
  if(event.key.toLowerCase()==='f'){event.preventDefault();void fullscreen();return;}
  if(mode==='calibrate'){
    const d={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(d){event.preventDefault();nudgeCorner(d[0],d[1],event.shiftKey?10:1);}return;
  }
  if(!doc)return;
  if(event.ctrlKey||event.metaKey){if(['+','=','-','0'].includes(event.key)){event.preventDefault();setScale(event.key==='0'?1:Math.max(.01,Math.min(10,patternScale+(event.key==='-'?-.1:.1))));updateMeasurement();}return;}
  const actions={p:()=>setTool('pan'),l:()=>$('measure-tool').click(),r:()=>$('rotate').click(),h:()=>$('flip-h').click(),v:()=>$('flip-v').click(),c:centerPattern,i:()=>$('invert').click(),z:()=>$('overview').click(),m:()=>$('magnify').click()};
  const action=actions[event.key.toLowerCase()];if(action){event.preventDefault();action();}
  if(layoutOptions.mode==='single'&&event.key==='PageDown'){event.preventDefault();goToPage(pageIndex+1);}if(layoutOptions.mode==='single'&&event.key==='PageUp'){event.preventDefault();goToPage(pageIndex-1);}
  const direction={ArrowLeft:[1,0],ArrowRight:[-1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[event.key];if(direction){event.preventDefault();pan.x+=direction[0]*(event.shiftKey?25:5);pan.y+=direction[1]*(event.shiftKey?25:5);drawPattern();}
});
restoreCalibration();updateColors('normal');setMode('calibrate');updateMeasurement();

// Installed-app launches still pass through mat calibration before opening a file.
if ('launchQueue' in window) window.launchQueue.setConsumer(async launch => {
  try {
    if (!launch.files?.length) return;
    const file = await launch.files[0].getFile();
    if (mode === 'project' && calibration.confirmed) await openFile(file);
    else { pendingLaunchFile = file; notify('Check your mat, then continue to open '+file.name+'.',false,true); }
  } catch { notify('This file could not be opened. Use Open pattern to select it again.',true); }
});
if ('serviceWorker' in navigator && !['localhost','127.0.0.1','[::1]'].includes(location.hostname)) window.addEventListener('load', () => {
  navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).catch(() => {});
});

// Optional browser tools mirror visible controls; they never open or transmit files.
const modelContext = document.modelContext;
if (modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const snapshot = () => ({mode,calibration:{...calibration,corners:calibration.corners.map(p=>({...p}))},
    document:doc?{name:doc.name,type:doc.type,pages:doc.pages.map(p=>({...p})),layers:doc.layers.map(l=>({...l})),physicalSizeConfirmed:imageSizeConfirmed}:null,
    pattern:layout?{layout:layoutOptions,widthMm:layout.width,heightMm:layout.height,tiles:layout.tiles.length,pan:{...pan},orientation:{...orientation},scale:patternScale*100,imageScale,viewMode,effectiveScale:effectiveScale(),marks:marks.map(m=>({...m})),selectedMark,color}:null});
  const register = definition => { try { void Promise.resolve(modelContext.registerTool(definition,{signal:lifecycle.signal})).catch(()=>{}); } catch {} };
  const pointSchema={type:'object',properties:{x:{type:'number'},y:{type:'number'}},required:['x','y'],additionalProperties:false};
  register({name:'read_perspective_view',description:'Read the current mat calibration, document metadata, pattern layout, orientation, scale, pan, and measurement marks. Coordinates are millimetres except calibration corners, which use screen pixels.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:snapshot});
  register({name:'set_perspective_view',description:'Adjust the same visible calibration corners or document controls. Corners can only change during calibration. Zoom is the pattern scale percentage; pan is in mat millimetres. Does not open or transmit files.',inputSchema:{type:'object',properties:{corners:{type:'array',minItems:4,maxItems:4,items:pointSchema},zoom:{type:'number',minimum:1,maximum:1000},pan:pointSchema,color:{type:'string',enum:['normal','green','white']}},additionalProperties:false},annotations:{readOnlyHint:false},execute(input){
    if(!input||Array.isArray(input)||Object.keys(input).some(key=>!['corners','zoom','pan','color'].includes(key)))throw new Error('Invalid view settings.');
    if(input.corners!==undefined&&(mode!=='calibrate'||!Array.isArray(input.corners)||input.corners.some(p=>!p)||!validQuad(input.corners)||input.corners.some(p=>p.x<6||p.y<6||p.x>innerWidth-6||p.y>innerHeight-6)))throw new Error('In calibration, supply four convex corners inside the screen.');
    if(input.zoom!==undefined&&(!doc||mode!=='project'||!Number.isFinite(input.zoom)||input.zoom<1||input.zoom>1000))throw new Error('Open a pattern and choose a scale between 1% and 1000%.');
    if(input.pan!==undefined&&(!doc||mode!=='project'||!input.pan||!Number.isFinite(input.pan.x)||!Number.isFinite(input.pan.y)))throw new Error('Open a pattern and provide a valid position.');
    if(input.color!==undefined&&!['normal','green','white'].includes(input.color))throw new Error('Invalid projection color.');
    if(input.corners){calibration.corners=input.corners.map(p=>({x:p.x,y:p.y}));calibration.confirmed=false;drawFrame();}
    if(input.zoom!==undefined){setScale(input.zoom/100);updateMeasurement();}if(input.pan){pan={x:input.pan.x,y:input.pan.y};drawPattern();}if(input.color)updateColors(input.color);
    return snapshot();
  }});
  window.addEventListener('pagehide',event=>{if(!event.persisted)lifecycle.abort();});
}
