"use client";

import { MouseEvent, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { VisionCamera, VisionEvent } from "./module-panels";

type Point={x:number;y:number};
type DeviceCamera={deviceId:string;label:string;camera:VisionCamera};

export function LiveCameraMonitor({cameras,organizationId,supabaseUrl,supabaseKey,onEvent,onZone,onCamera}:{cameras:VisionCamera[];organizationId:string;supabaseUrl:string;supabaseKey:string;onEvent:(event:VisionEvent)=>void;onZone:(id:string,points:Point[])=>void;onCamera:(camera:VisionCamera)=>void}){
 const [feeds,setFeeds]=useState<DeviceCamera[]>([]),[starting,setStarting]=useState(false),[message,setMessage]=useState(""),[notifications,setNotifications]=useState(()=>typeof window==="undefined"||localStorage.getItem("hse-vision-notifications")!=="off");
 function toggleNotifications(){const next=!notifications;setNotifications(next);localStorage.setItem("hse-vision-notifications",next?"on":"off");if(next&&"Notification"in window&&Notification.permission==="default")Notification.requestPermission()}
 async function platformCamera(device:MediaDeviceInfo,index:number){
  const label=device.label||`Камера ${index+1}`, existing=cameras.find(camera=>camera.name===label)||cameras[index];
  if(existing)return existing;
  const created=await createClient(supabaseUrl,supabaseKey).from("vision_cameras").insert({organization_id:organizationId,name:label,location:index===0?"Камера устройства":"Подключённая камера",status:"online"}).select().single();
  if(created.error)throw created.error;onCamera(created.data as VisionCamera);return created.data as VisionCamera;
 }
 async function startAll(){
  setStarting(true);setMessage("");
  try{
   const permission=await navigator.mediaDevices.getUserMedia({video:true,audio:false});permission.getTracks().forEach(track=>track.stop());
   const devices=(await navigator.mediaDevices.enumerateDevices()).filter(item=>item.kind==="videoinput");
   const mapped:DeviceCamera[]=[];for(let index=0;index<devices.length;index++)mapped.push({deviceId:devices[index].deviceId,label:devices[index].label||`Камера ${index+1}`,camera:await platformCamera(devices[index],index)});
   setFeeds(mapped);if(!mapped.length)setMessage("Камеры не обнаружены.");
  }catch(error){setMessage(error instanceof Error?error.message:"Не удалось открыть камеры.")}
  setStarting(false);
 }
 return <section className="panel live-monitor security-wall"><div className="panel-title"><div><span className="eyebrow vision">SAFETY VISION CLOUD</span><h3>Центр видеоконтроля</h3><p className="muted">Встроенная камера запускается первой. Дополнительные камеры появляются отдельными экранами.</p></div><div className="vision-master-actions"><button type="button" className={`notification-switch ${notifications?"enabled":""}`} onClick={toggleNotifications}>{notifications?"🔔 Уведомления включены":"🔕 Уведомления выключены"}</button><button type="button" className="button dark" onClick={startAll} disabled={starting}>{starting?"Подключение…":feeds.length?"Обновить камеры":"Подключить все камеры"}</button></div></div>
 <div className="vision-architecture"><span><b>EDGE</b> камера и анализ на объекте</span><i>→</i><span><b>CLOUD</b> события и журнал HSE Radar</span><i>→</i><span><b>ALERTS</b> уведомления в центре уведомлений</span></div>
 {feeds.length?<div className={`camera-wall ${feeds.length===1?"single":""}`}>{feeds.map(feed=><CameraFeed key={feed.deviceId} feed={{...feed,camera:cameras.find(camera=>camera.id===feed.camera.id)||feed.camera}} organizationId={organizationId} supabaseUrl={supabaseUrl} supabaseKey={supabaseKey} notifications={notifications} onEvent={onEvent} onZone={onZone}/>)}</div>:<div className="camera-wall-empty"><strong>Камеры ещё не подключены</strong><span>Нажмите «Подключить все камеры» и разрешите доступ. Видео обрабатывается в браузере и не отправляется в облако.</span></div>}
 {message&&<div className="camera-alert">{message}<button type="button" onClick={()=>setMessage("")}>×</button></div>}</section>
}

function CameraFeed({feed,organizationId,supabaseUrl,supabaseKey,notifications,onEvent,onZone}:{feed:DeviceCamera;organizationId:string;supabaseUrl:string;supabaseKey:string;notifications:boolean;onEvent:(event:VisionEvent)=>void;onZone:(id:string,points:Point[])=>void}){
 const video=useRef<HTMLVideoElement>(null),analysis=useRef<HTMLCanvasElement>(null),stream=useRef<MediaStream|null>(null),timer=useRef<number|null>(null),previous=useRef<Uint8ClampedArray|null>(null),activeEpisode=useRef(false),quietFrames=useRef(0),pointsRef=useRef<Point[]>([]),notificationsRef=useRef(notifications),sensitivityRef=useRef(12);
 const [running,setRunning]=useState(false),[drawing,setDrawing]=useState(false),[alert,setAlert]=useState(""),[sensitivity,setSensitivity]=useState(12);
 const points=feed.camera.zone_points||[];
 pointsRef.current=points;notificationsRef.current=notifications;sensitivityRef.current=sensitivity;
 // A feed owns its MediaStream lifecycle; changing the hardware id replaces it.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{start();return stop},[feed.deviceId]);
 function stop(){if(timer.current)window.clearInterval(timer.current);timer.current=null;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;previous.current=null;activeEpisode.current=false;setRunning(false)}
 async function start(){try{stop();const media=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:feed.deviceId}},audio:false});stream.current=media;if(video.current){video.current.srcObject=media;await video.current.play()}setRunning(true);timer.current=window.setInterval(detect,350)}catch(error){setAlert(error instanceof Error?error.message:"Камера недоступна")}}
 function inside(x:number,y:number,polygon:Point[]){let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if(((a.y>y)!==(b.y>y))&&(x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x))hit=!hit}return hit}
 async function detect(){const zone=pointsRef.current;if(!video.current||!analysis.current||zone.length<3||video.current.readyState<2)return;const canvas=analysis.current,ctx=canvas.getContext("2d",{willReadFrequently:true});if(!ctx)return;canvas.width=160;canvas.height=90;ctx.drawImage(video.current,0,0,160,90);const current=ctx.getImageData(0,0,160,90).data;if(previous.current){let changed=0,total=0;for(let y=0;y<90;y+=2)for(let x=0;x<160;x+=2)if(inside(x/160,y/90,zone)){const i=(y*160+x)*4,now=(current[i]+current[i+1]+current[i+2])/3,old=(previous.current[i]+previous.current[i+1]+previous.current[i+2])/3;total++;if(Math.abs(now-old)>28)changed++}const ratio=total?changed/total*100:0;if(ratio>=sensitivityRef.current){quietFrames.current=0;if(!activeEpisode.current){activeEpisode.current=true;await emit(ratio)}}else if(activeEpisode.current&&++quietFrames.current>=3){activeEpisode.current=false;quietFrames.current=0}}previous.current=new Uint8ClampedArray(current)}
 async function emit(confidence:number){const text=`Движение в опасной зоне · ${feed.camera.name}`;setAlert(text);if(notificationsRef.current&&"Notification"in window&&Notification.permission==="granted")new Notification("HSE Radar · Safety Vision",{body:text,icon:"/icon.svg"});const response=await fetch("/api/vision/events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({organizationId,cameraId:feed.camera.id,eventType:"danger_zone",confidence:Math.min(99.99,confidence),notes:"Автоматически: движение внутри заданного контура",notify:notificationsRef.current})});const result=await response.json();if(response.ok)onEvent(result.event as VisionEvent);else setAlert(result.error||"Не удалось сохранить событие")}
 function addPoint(event:MouseEvent<SVGSVGElement>){if(!drawing)return;const rect=event.currentTarget.getBoundingClientRect(),point={x:Number(((event.clientX-rect.left)/rect.width).toFixed(4)),y:Number(((event.clientY-rect.top)/rect.height).toFixed(4))};onZone(feed.camera.id,[...points,point])}
 async function saveZone(){if(points.length<3)return;const result=await createClient(supabaseUrl,supabaseKey).from("vision_cameras").update({zone_points:points,status:"online"}).eq("id",feed.camera.id);if(result.error)return setAlert(result.error.message);setDrawing(false);setAlert("Контур сохранён. Контроль активен.")}
 return <article className={`camera-tile ${alert.includes("Движение")?"in-alert":""}`}><header><div><strong>{feed.label}</strong><small>{feed.camera.location}</small></div><span className={`live-state ${running?"online":""}`}>{running?"● LIVE":"● OFFLINE"}</span></header><div className="live-frame"><video ref={video} muted playsInline/><svg viewBox="0 0 1000 562" preserveAspectRatio="none" onClick={addPoint}><polygon points={points.map(point=>`${point.x*1000},${point.y*562}`).join(" ")}/>{points.map((point,index)=><circle key={index} cx={point.x*1000} cy={point.y*562} r="8"/>)}</svg>{!running&&<div className="camera-placeholder">Камера недоступна</div>}</div><canvas ref={analysis} hidden/><div className="camera-tile-controls"><label>Порог {sensitivity}%<input type="range" min="4" max="30" value={sensitivity} onChange={event=>setSensitivity(Number(event.target.value))}/></label><div><button type="button" onClick={()=>setDrawing(value=>!value)}>{drawing?"Завершить":"Задать зону"}</button><button type="button" disabled={!drawing} onClick={()=>onZone(feed.camera.id,[])}>Очистить</button><button type="button" disabled={points.length<3} onClick={saveZone}>Сохранить</button><button type="button" onClick={running?stop:start}>{running?"Стоп":"Старт"}</button></div></div>{alert&&<div className="camera-alert compact">{alert}<button type="button" onClick={()=>setAlert("")}>×</button></div>}</article>
}
