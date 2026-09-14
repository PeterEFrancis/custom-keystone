import { WIDTH, HEIGHT, homography, validQuad } from './geometry.js';

const $ = id => document.getElementById(id);
const stage = $('stage'), frame = $('frame'), viewport = $('viewport');
let points = [], stageSize = { width:0, height:0 };
const names = ['Top left','Top right','Bottom right','Bottom left'];
const handles = names.map((name,i)=>{
  const button = document.createElement('button');
  button.className='handle'; button.setAttribute('aria-label',`${name} corner. Use arrow keys to move; Shift for larger steps.`);
  $('handles').append(button);
  let pointer = null;
  button.addEventListener('pointerdown',e=>{e.preventDefault();pointer=e.pointerId;button.setPointerCapture(pointer);button.classList.add('dragging');});
  button.addEventListener('pointermove',e=>{if(e.pointerId!==pointer)return;const bounds=stage.getBoundingClientRect();moveCorner(i,e.clientX-bounds.left,e.clientY-bounds.top);});
  const release=()=>{pointer=null;button.classList.remove('dragging');};
  button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);button.addEventListener('lostpointercapture',release);
  button.addEventListener('keydown',e=>{const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[e.key];if(!delta)return;e.preventDefault();const step=e.shiftKey?10:2;moveCorner(i,points[i].x+delta[0]*step,points[i].y+delta[1]*step);});
  return button;
});
function draw(){frame.style.transform=`matrix3d(${homography(points).join(',')})`;frame.style.setProperty('--ui-scale',WIDTH/Math.max(80,(Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)+Math.hypot(points[2].x-points[3].x,points[2].y-points[3].y))/2));$('polygon').setAttribute('points',points.map(p=>`${p.x},${p.y}`).join(' '));handles.forEach((el,i)=>{el.style.left=`${points[i].x}px`;el.style.top=`${points[i].y}px`;});}
function resetFrame(){const w=Math.min(stage.clientWidth*.76,700,stage.clientHeight*1.5),h=w/1.5;const x=(stage.clientWidth-w)/2,y=(stage.clientHeight-h)/2;points=[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];draw();}
function moveCorner(i,x,y){const next=points.map(p=>({...p}));next[i]={x:Math.max(6,Math.min(stage.clientWidth-6,x)),y:Math.max(6,Math.min(stage.clientHeight-6,y))};if(validQuad(next)){points=next;draw();}}
new ResizeObserver(()=>{const width=stage.clientWidth,height=stage.clientHeight;if(!points.length||!stageSize.width||!stageSize.height)resetFrame();else{points=points.map(p=>({x:p.x*width/stageSize.width,y:p.y*height/stageSize.height}));draw();}stageSize={width,height};}).observe(stage);
$('reset').addEventListener('click',resetFrame);
$('empty').addEventListener('click',()=>$('file-input').click());
$('open').addEventListener('click',()=>$('file-input').click());
resetFrame();

let zoom = 1, current = null, loadSequence = 0, noticeTimer;
let pdfLibraryPromise, activeLoadingTask = null, renderRunning = false, renderRequested = false;
const pageControls=document.createElement('div');
pageControls.className='page-controls';pageControls.hidden=true;
pageControls.innerHTML='<button id="previous-page" aria-label="Previous PDF page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><span id="page-count" class="page-count"></span><button id="next-page" aria-label="Next PDF page"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg></button>';
$('hint').after(pageControls);

function notify(message, persistent=false){clearTimeout(noticeTimer);$('notice').textContent=message;if(message&&!persistent)noticeTimer=setTimeout(()=>$('notice').textContent='',5000);}
function setLoading(loading){viewport.classList.toggle('loading',loading);viewport.setAttribute('aria-busy',String(loading));}
function updateControls(){
  $('zoom-value').textContent=`${Math.round(zoom*100)}%`;
  $('zoom-out').disabled=!current||zoom<=.25;
  $('zoom-in').disabled=!current||zoom>=4;
  $('fit').disabled=!current;
  pageControls.hidden=current?.type!=='pdf'||current.count<2;
  $('hint').hidden=!pageControls.hidden;
  if(current?.type==='pdf'){
    const first=Math.min(current.count,Math.floor((viewport.scrollTop+1)/(HEIGHT*zoom))+1);
    const last=Math.min(current.count,Math.ceil((viewport.scrollTop+HEIGHT)/(HEIGHT*zoom)));
    $('page-count').textContent=first===last?`Page ${first} of ${current.count}`:`Pages ${first}–${last} of ${current.count}`;
    $('previous-page').disabled=viewport.scrollTop<=1;
    $('next-page').disabled=viewport.scrollTop>=viewport.scrollHeight-viewport.clientHeight-1;
  }
}
function layoutDocument(){
  if(!current)return;
  const pages=$('pages');pages.style.width=`${WIDTH*zoom}px`;pages.style.height=`${HEIGHT*zoom*current.count}px`;
  pages.style.marginLeft=zoom<1?`${WIDTH*(1-zoom)/2}px`:'0';
  pages.style.marginTop=zoom<1&&current.count===1?`${HEIGHT*(1-zoom)/2}px`:'0';
  current.slots.forEach(slot=>{slot.element.style.height=`${HEIGHT*zoom}px`;});
}
function setZoom(value,anchor={x:WIDTH/2,y:HEIGHT/2}){
  if(!current)return;
  const next=Math.max(.25,Math.min(4,value));
  const ratio=next/zoom;
  const offsetX=z=>z<1?WIDTH*(1-z)/2:0;
  const offsetY=z=>z<1&&current.count===1?HEIGHT*(1-z)/2:0;
  const left=(viewport.scrollLeft+anchor.x-offsetX(zoom))*ratio+offsetX(next)-anchor.x;
  const top=(viewport.scrollTop+anchor.y-offsetY(zoom))*ratio+offsetY(next)-anchor.y;
  zoom=next;layoutDocument();viewport.scrollLeft=left;viewport.scrollTop=top;updateControls();scheduleRender();
}
$('zoom-in').addEventListener('click',()=>setZoom(Math.round((zoom+.25)*100)/100));
$('zoom-out').addEventListener('click',()=>setZoom(Math.round((zoom-.25)*100)/100));
$('fit').addEventListener('click',()=>{setZoom(1);viewport.scrollLeft=0;});
viewport.addEventListener('wheel',e=>{
  if(!current||!(e.ctrlKey||e.metaKey))return;e.preventDefault();
  // Convert the screen pointer back into the unwarped scrollport.
  const bounds=stage.getBoundingClientRect(),matrix=new DOMMatrix(frame.style.transform).inverse();
  const p=new DOMPoint(e.clientX-bounds.left,e.clientY-bounds.top,0,1).matrixTransform(matrix);
  setZoom(zoom*Math.exp(-e.deltaY*.004),{x:p.x/p.w,y:p.y/p.w});
},{passive:false});
viewport.addEventListener('scroll',()=>{updateControls();scheduleRender();},{passive:true});
function changePage(delta){if(current?.type!=='pdf')return;const pageHeight=HEIGHT*zoom;const index=delta>0?Math.floor((viewport.scrollTop+1)/pageHeight)+1:Math.ceil((viewport.scrollTop-1)/pageHeight)-1;viewport.scrollTop=Math.max(0,Math.min(current.count-1,index))*pageHeight;}
$('previous-page').addEventListener('click',()=>changePage(-1));$('next-page').addEventListener('click',()=>changePage(1));

function dispose(doc){
  if(!doc)return;
  doc.disposed=true;
  for(const slot of doc.slots??[]){slot.task?.cancel();if(slot.canvas){slot.canvas.width=0;slot.canvas.height=0;}}
  if(doc.url)URL.revokeObjectURL(doc.url);
  if(doc.pdf)void doc.pdf.destroy().catch(()=>{});
}
function makeSlot(index){const element=document.createElement('div');element.className='page';element.setAttribute('aria-label',`Page ${index+1}`);return {element,canvas:null,task:null,rendering:false,resolution:0};}
function commitDocument(doc,name){
  dispose(current);current=doc;zoom=1;
  $('pages').replaceChildren(...doc.slots.map(s=>s.element));$('pages').style.display='block';$('empty').hidden=true;
  document.body.classList.add('loaded');$('file-name').textContent=name;$('open').title=`Replace ${name}`;
  $('hint').textContent='Drag the corners to reshape';
  layoutDocument();viewport.scrollTop=0;viewport.scrollLeft=0;updateControls();scheduleRender();
}
async function loadImage(file){
  const url=URL.createObjectURL(file),img=new Image();img.alt=file.name;img.draggable=false;img.src=url;
  try{await img.decode();if(!img.naturalWidth)throw new Error('Invalid image');}
  catch(error){URL.revokeObjectURL(url);throw new Error('This image could not be opened. Try a PNG, JPEG, WebP, or SVG.');}
  const slot=makeSlot(0);slot.element.append(img);return {type:'image',url,count:1,slots:[slot]};
}
async function loadPdf(file,sequence){
  pdfLibraryPromise??=import('./vendor/pdfjs/build/pdf.min.mjs').catch(error=>{pdfLibraryPromise=null;throw error;});
  const lib=await pdfLibraryPromise;
  lib.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/build/pdf.worker.min.mjs',import.meta.url).href;
  const assetBase=new URL('./vendor/pdfjs/',import.meta.url).href;
  const data=new Uint8Array(await file.arrayBuffer());
  if(sequence!==loadSequence)throw new Error('A newer file was selected.');
  const task=lib.getDocument({data,cMapUrl:assetBase+'cmaps/',cMapPacked:true,standardFontDataUrl:assetBase+'standard_fonts/',wasmUrl:assetBase+'wasm/',iccUrl:assetBase+'iccs/',isEvalSupported:false});
  activeLoadingTask=task;
  let pdf;
  try{
    pdf=await task.promise;
    const doc={type:'pdf',pdf,count:pdf.numPages,slots:Array.from({length:pdf.numPages},(_,i)=>makeSlot(i))};
    await renderPage(doc,0,1);
    return doc;
  }catch(error){void task.destroy().catch(()=>{});if(error.name==='PasswordException')throw new Error('This PDF needs a password. Please open an unlocked copy.');throw new Error('This PDF could not be opened. Try another PDF.');}
  finally{if(activeLoadingTask===task)activeLoadingTask=null;}
}
async function openFile(file){
  if(!file)return;
  const isPdf=file.type==='application/pdf'||/\.pdf$/i.test(file.name);
  const isImage=file.type.startsWith('image/')||/\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i.test(file.name);
  if(!isPdf&&!isImage){notify('Choose a PDF or an image file.');return;}
  const sequence=++loadSequence;setLoading(true);notify(`Opening ${file.name}…`,true);
  if(activeLoadingTask){void activeLoadingTask.destroy().catch(()=>{});activeLoadingTask=null;}
  try{
    const doc=isPdf?await loadPdf(file,sequence):await loadImage(file);
    if(sequence!==loadSequence){dispose(doc);return;}
    commitDocument(doc,file.name);notify('');viewport.focus({preventScroll:true});
  }catch(error){if(sequence===loadSequence)notify(error.message||'The file could not be opened. Please try again.');}
  finally{if(sequence===loadSequence)setLoading(false);}
}
$('file-input').addEventListener('change',e=>{void openFile(e.target.files[0]);e.target.value='';});
let dragDepth=0;
document.addEventListener('dragenter',e=>{if(!e.dataTransfer?.types.includes('Files'))return;e.preventDefault();dragDepth++;document.body.classList.add('drag-over');});
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
document.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;document.body.classList.remove('drag-over');}});
document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;document.body.classList.remove('drag-over');void openFile(e.dataTransfer?.files[0]);});

// Render nearby pages only, and release distant canvases to bound PDF memory use.
function renderResolution(value){return Math.min(3200,Math.ceil(WIDTH*Math.max(1.5,value)*Math.min(devicePixelRatio||1,1.5)));}
async function renderPage(doc,index,value){
  const slot=doc.slots[index],target=renderResolution(value);
  if(slot.rendering||slot.resolution>=target)return;
  slot.rendering=true;
  try{
    const page=await doc.pdf.getPage(index+1),base=page.getViewport({scale:1});
    if(doc.disposed)return;
    const scale=Math.min(target/base.width,Math.sqrt(8000000/(base.width*base.height)));
    const view=page.getViewport({scale}),canvas=document.createElement('canvas');
    canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);canvas.setAttribute('aria-label',`PDF page ${index+1}`);canvas.setAttribute('role','img');
    const context=canvas.getContext('2d',{alpha:false});
    slot.task=page.render({canvasContext:context,viewport:view});await slot.task.promise;
    if(doc.disposed){canvas.width=0;canvas.height=0;return;}
    if(slot.canvas){slot.canvas.width=0;slot.canvas.height=0;}
    slot.element.replaceChildren(canvas);slot.canvas=canvas;slot.resolution=target;page.cleanup();
  }finally{slot.task=null;slot.rendering=false;}
}
function scheduleRender(){
  if(current?.type!=='pdf')return;
  renderRequested=true;if(renderRunning)return;
  renderRunning=true;
  requestAnimationFrame(async()=>{
    try{while(renderRequested){renderRequested=false;await renderVisible();}}
    finally{renderRunning=false;}
  });
}
async function renderVisible(){
  const doc=current;if(doc?.type!=='pdf')return;
  const first=Math.max(0,Math.floor(viewport.scrollTop/(HEIGHT*zoom))-1);
  const last=Math.min(doc.count-1,Math.ceil((viewport.scrollTop+HEIGHT)/(HEIGHT*zoom)));
  doc.slots.forEach((slot,i)=>{if((i<first-1||i>last+1)&&!slot.rendering&&slot.canvas){slot.canvas.remove();slot.canvas.width=0;slot.canvas.height=0;slot.canvas=null;slot.resolution=0;}});
  for(let i=first;i<=last&&current===doc;i++){
    try{await renderPage(doc,i,zoom);}
    catch(error){if(error.name!=='RenderingCancelledException'&&current===doc){notify(`Page ${i+1} could not be displayed.`);}}
    if(renderRequested)break;
  }
}
window.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='o'){e.preventDefault();$('file-input').click();}
  if(!current||!(e.ctrlKey||e.metaKey))return;
  if(e.key==='+'||e.key==='='){e.preventDefault();setZoom(zoom+.25);}
  if(e.key==='-'){e.preventDefault();setZoom(zoom-.25);}
  if(e.key==='0'){e.preventDefault();setZoom(1);}
});

// Expose the same visible frame and document controls in supporting browsers.
const modelContext=document.modelContext;
if(modelContext?.registerTool){
  const lifecycle=new AbortController();
  const snapshot=()=>({corners:points.map(p=>({...p})),zoom:Math.round(zoom*100),document:current?{type:current.type,pages:current.count}:null,scroll:{x:viewport.scrollLeft,y:viewport.scrollTop}});
  const register=tool=>{try{void Promise.resolve(modelContext.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{}};
  register({name:'read_perspective_view',description:'Read the frame corners, document type, zoom percentage, and scroll position.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:snapshot});
  register({name:'set_perspective_view',description:'Adjust frame corners in workspace pixels, zoom percentage, or scroll position using the same controls as the viewer. Does not open or transmit files.',inputSchema:{type:'object',properties:{corners:{type:'array',minItems:4,maxItems:4,items:{type:'object',properties:{x:{type:'number'},y:{type:'number'}},required:['x','y'],additionalProperties:false}},zoom:{type:'number',minimum:25,maximum:400},scroll:{type:'object',properties:{x:{type:'number',minimum:0},y:{type:'number',minimum:0}},required:['x','y'],additionalProperties:false}},additionalProperties:false},annotations:{readOnlyHint:false},execute(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['corners','zoom','scroll'].includes(k)))throw new Error('Invalid view settings.');
    const {corners,zoom:value,scroll}=input;
    if(Object.hasOwn(input,'corners')&&(!Array.isArray(corners)||corners.some(p=>!p||typeof p!=='object'||Object.keys(p).some(k=>!['x','y'].includes(k)))||!validQuad(corners)||corners.some(p=>p.x<6||p.y<6||p.x>stage.clientWidth-6||p.y>stage.clientHeight-6)))throw new Error('Corners must form a convex box inside the workspace.');
    if(value!==undefined&&(!Number.isFinite(value)||value<25||value>400||!current))throw new Error('Open a document and choose a zoom from 25 to 400.');
    if(Object.hasOwn(input,'scroll')&&(!scroll||typeof scroll!=='object'||Object.keys(scroll).some(k=>!['x','y'].includes(k))||!current||!Number.isFinite(scroll.x)||!Number.isFinite(scroll.y)||scroll.x<0||scroll.y<0))throw new Error('Open a document and provide a valid scroll position.');
    if(corners){points=corners.map(p=>({...p}));draw();}if(value!==undefined)setZoom(value/100);if(scroll){viewport.scrollLeft=scroll.x;viewport.scrollTop=scroll.y;}return snapshot();
  }});
  window.addEventListener('pagehide',event=>{if(!event.persisted)lifecycle.abort();});
}
