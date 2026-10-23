type Transport={getStats:()=>Promise<RTCStatsReport>|undefined}
type Manager={mode:string;publisher:Transport;subscriber?:Transport}
async function route(transport?:Transport){
  const stats=await transport?.getStats();let selectedRelay=false,hostCandidates=0
  stats?.forEach(report=>{
    if(report.type==='local-candidate'&&report.candidateType==='host')hostCandidates++
    if(report.type==='transport'&&report.selectedCandidatePairId){const pair=stats.get(report.selectedCandidatePairId),candidate=pair&&stats.get(pair.localCandidateId);if(candidate?.candidateType==='relay')selectedRelay=true}
    if(report.type==='candidate-pair'&&report.nominated&&report.state==='succeeded'&&stats.get(report.localCandidateId)?.candidateType==='relay')selectedRelay=true
  });return {selectedRelay,hostCandidates}
}
/** The pinned SDK may use one bidirectional PC or separate publish/subscribe PCs.
 * Missing stats never establish relay privacy. */
export async function sfuRoutes(manager?:Manager){
  if(manager?.mode==='publisher-only'){const shared=await route(manager.publisher);return [shared,shared]}
  return Promise.all([route(manager?.publisher),route(manager?.subscriber)])
}
