/** Explicit local routing proof using the actual Caddy binary and the production matcher source. */
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { spawnOwned, stopOwned } from "../../owned-process.mjs";
const source=process.env.CADDY_SOURCE_FILE??"infra/production/runtime/platform.caddy";
const port=Number(process.env.CADDY_PROBE_PORT??18515);
const directory=await mkdtemp(resolve(tmpdir(),"inside-1712-caddy-"));
const calls=[];
function query(method,path) {return new Promise((done,reject)=>{const outgoing=request({hostname:"127.0.0.1",port,path,method,headers:{Host:`sachkov.dev:${port}`}},response=>{const chunks=[];response.on("data",chunk=>chunks.push(chunk));response.on("end",()=>done({status:response.statusCode,body:Buffer.concat(chunks).toString("utf8")}));});outgoing.on("error",reject);outgoing.end();});}
const api=createServer((request,response)=>{calls.push(`${request.method} ${request.url}`);response.writeHead(200,{"content-type":"application/json"});response.end(JSON.stringify({owner:"api",items:[]}));});
const web=createServer((_request,response)=>{response.writeHead(404);response.end();});
let child;
try {
 await new Promise(done=>api.listen(0,"127.0.0.1",done));await new Promise(done=>web.listen(0,"127.0.0.1",done));
 const text=(await readFile(source,"utf8")).replace("sachkov.dev, inside.sachkov.dev {",`http://sachkov.dev:${port}, http://inside.sachkov.dev:${port} {`).replace("www.sachkov.dev {",`http://www.sachkov.dev:${port} {`);
 const config=resolve(directory,"Caddyfile");await writeFile(config,`{\n admin off\n}\n${text}`);
 child=spawnOwned(process.env.CADDY_EXECUTABLE??"caddy",["run","--config",config,"--adapter","caddyfile"],{env:{...process.env,PLATFORM_API_UPSTREAM:`127.0.0.1:${api.address().port}`,PLATFORM_WEB_UPSTREAM:`127.0.0.1:${web.address().port}`},stdio:["ignore","pipe","pipe"]});
 let log="";child.stdout.on("data",part=>log+=part);child.stderr.on("data",part=>log+=part);
 const deadline=performance.now()+10000;
 while(true){assert.equal(child.exitCode,null,log);try{await query("GET","/health");break;}catch(error){if(performance.now()>deadline)throw error;await setTimeout(50);}}
 for(const[method,path,status]of[["GET","/billing/product-sales-states",200],["POST","/billing/product-sales-states",404],["GET","/billing/cohorts",404],["GET","/billing/product-sales-states/private",404],["GET","/internal/private",404],["GET","/health",404]]){
  const response=await query(method,path);console.log(JSON.stringify({source,method,path,status:response.status,expected:status}));assert.equal(response.status,status);
 }
 assert.deepEqual(calls,["GET /billing/product-sales-states"]);
 console.log(JSON.stringify({source,apiCalls:calls,privatePathsBlocked:true}));
}finally{
 if(child)await stopOwned(child);
 await new Promise((done,reject)=>api.close(e=>e?reject(e):done()));await new Promise((done,reject)=>web.close(e=>e?reject(e):done()));
 await rm(directory,{recursive:true,force:true});
}
