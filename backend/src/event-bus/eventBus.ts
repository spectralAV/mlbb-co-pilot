import { EventEmitter } from "node:events";
const emitter = new EventEmitter();
const recentEvents:any[] = [];
export const eventBus = {
  emit(type:string, payload:any){ const event={type,payload,timestamp:Date.now()}; recentEvents.unshift(event); recentEvents.splice(100); emitter.emit(type,payload); emitter.emit("*",event); return event; },
  on(type:string, cb:(payload:any)=>void){ emitter.on(type, cb); },
  off(type:string, cb:(payload:any)=>void){ emitter.off(type, cb); },
  subscribe(cb:(event:any)=>void){ emitter.on("*", cb); return ()=>emitter.off("*", cb); },
  recent(){ return recentEvents; }
};
