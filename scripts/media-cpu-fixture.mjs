// Read only CPU counters for explicit disposable fixture roots and descendants.
import {spawnSync} from 'node:child_process'
export function cpuSnapshot(roots,containers=[]){
  roots=roots.filter(value=>Number.isSafeInteger(value)&&value>0)
  let processes=[]
  if(process.platform==='win32'&&roots.length){
    const code=`$roots=@(${roots.join(',')});$all=Get-CimInstance Win32_Process;$ids=[System.Collections.Generic.HashSet[uint32]]::new();foreach($id in $roots){[void]$ids.Add($id)};do{$changed=$false;foreach($p in $all){if($ids.Contains([uint32]$p.ParentProcessId)-and $ids.Add([uint32]$p.ProcessId)){$changed=$true}}}while($changed);@($all|Where-Object {$ids.Contains([uint32]$_.ProcessId)}|ForEach-Object {@{pid=[uint32]$_.ProcessId;seconds=([double]$_.KernelModeTime+[double]$_.UserModeTime)/10000000}})|ConvertTo-Json -Compress`
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',code],{encoding:'utf8',windowsHide:true,timeout:15000})
    if(result.status===0)try{processes=JSON.parse(result.stdout);if(!Array.isArray(processes))processes=[processes]}catch{}
  }
  const docker=[]
  for(const container of containers.filter(Boolean)){
    if(!/^hearth-call-(sfu|turn)-[a-f0-9-]+$/.test(container))throw new Error('CPU measurement is restricted to fixture containers')
    const result=spawnSync('docker',['exec',container,'cat','/sys/fs/cgroup/cpu.stat'],{encoding:'utf8',windowsHide:true,timeout:10000})
    const usage=result.status===0?result.stdout.match(/^usage_usec (\d+)$/m):null
    if(usage)docker.push({container,seconds:Number(usage[1])/1000000})
  }
  return {at:Date.now(),processes,docker}
}
export function cpuDelta(before,after){
  const elapsedSeconds=(after.at-before.at)/1000
  const total=(records,old,key)=>records.reduce((sum,item)=>{const previous=old.find(value=>value[key]===item[key]);return sum+(previous?Math.max(0,item.seconds-previous.seconds):0)},0)
  return {elapsedSeconds,fixtureProcessCpuSeconds:total(after.processes,before.processes,'pid'),fixtureContainerCpuSeconds:total(after.docker,before.docker,'container'),processCounters:after.processes.length,containerCounters:after.docker.length,scope:'Existing fixture processes and container cgroup counters only; excludes processes that exited during the interval and total system activity'}
}
