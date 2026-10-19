/* APFIL/Akil OEE dashboard engine — fetches live Google Sheet CSV (gviz) and builds the day/MTD/trend data. */
(function(){
"use strict";

function parseCSV(text){
  var rows=[], row=[], cur="", i=0, inQ=false;
  text = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  while(i<text.length){
    var ch=text[i];
    if(inQ){
      if(ch==='"'){ if(text[i+1]==='"'){cur+='"';i+=2;continue;} inQ=false;i++;continue; }
      cur+=ch;i++;continue;
    }
    if(ch==='"'){ inQ=true;i++;continue; }
    if(ch===','){ row.push(cur);cur="";i++;continue; }
    if(ch==="\n"){ row.push(cur);rows.push(row);row=[];cur="";i++;continue; }
    cur+=ch;i++;
  }
  row.push(cur); rows.push(row);
  return rows;
}
function num(v){ if(v==null)return 0; var x=parseFloat(String(v).replace(/,/g,"")); return isNaN(x)?0:x; }
function toDate(s){
  if(!s)return null; s=String(s).trim(); if(!s)return null;
  var m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(m){ return new Date(+m[3], +m[1]-1, +m[2]); }
  m=s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if(m){ var mon={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11}[m[2].toLowerCase()]; return new Date(+m[3],mon,+m[1]); }
  var d=new Date(s); return isNaN(d.getTime())?null:d;
}
var MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function pad2(n){return (n<10?"0":"")+n;}
function fmtD(d){ return pad2(d.getDate())+"-"+MON[d.getMonth()]; }
function fmtDU(d){ return pad2(d.getDate())+"-"+MON[d.getMonth()].toUpperCase()+"-"+d.getFullYear(); }
function fmtM(d){ return MON[d.getMonth()]+" MTD"; }
function r1(x){ return Math.round(x*10)/10; }              // percent, 1dp
function r0(x){ return Math.round(x); }
function key(d){ return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }

var CAT=["Unavailable Order","In Process Setup","Utility (Gas)","Utility (Electricity)","Raw Material Shortage","Manpower Shortage","QCO","Warehouse block","Mechanical Breakdown","Electrical Breakdown","Others down time"];
var TEAM={U:"Electrical / Utility",E:"Electrical",M:"Mechanical",I:"Production / Process",R:"Procurement \u2192 Production",W:"Dispatch / Warehouse \u2192 Production",Q:"Production / Process",O:"Operations",P:"Maintenance"};
var ACT={U:"Power supply reliability; auto-changeover / captive power; power-quality plan.",E:"Electrical PM; protection &amp; spares; thermography.",M:"Mechanical PM; inspect &amp; replace worn parts; spares.",I:"Reduce setup/changeover; standard work.",R:"Material supply &amp; stock planning; sequencing.",W:"Sync dispatch; clear storage; add level alarm.",Q:"SMED / reduce changeover; quick-change tooling.",O:"Routine inspection; operator standard work.",P:"Re-plan PM timing; shorten duration."};
function teamOf(reason,cat){
  var c=(cat||"").toLowerCase();
  if(c.indexOf("planned")>=0) return "Maintenance";
  if(c.indexOf("warehouse")>=0) return TEAM.W;
  if(c.indexOf("mechanical")>=0) return TEAM.M;
  if(c.indexOf("electrical")>=0) return TEAM.E;
  if(c.indexOf("utility")>=0) return TEAM.U;
  if(c.indexOf("raw material")>=0) return TEAM.R;
  if(c.indexOf("in process")>=0) return TEAM.I;
  var p=(reason||"").trim().charAt(0).toUpperCase();
  return TEAM[p]||"Operations";
}
function actOf(reason,cat){
  var c=(cat||"").toLowerCase();
  if(c.indexOf("planned")>=0) return ACT.P;
  if(c.indexOf("warehouse")>=0) return ACT.W;
  if(c.indexOf("mechanical")>=0) return ACT.M;
  if(c.indexOf("electrical")>=0) return ACT.E;
  if(c.indexOf("utility")>=0) return ACT.U;
  if(c.indexOf("raw material")>=0) return ACT.R;
  if(c.indexOf("in process")>=0) return ACT.I;
  var p=(reason||"").trim().charAt(0).toUpperCase();
  return ACT[p]||ACT.O;
}

/* cfg: { groupCol, col:{...}, bdCol:{...}, perfBasis, crushCol, cardMetric, units, titles... } */
function aggSet(recs,cfg){
  var op=0,planned=0,run=0,npt=0,out=0,good=0,target=0,idealOut=0;
  for(var i=0;i<recs.length;i++){ var r=recs[i];
    op+=r.op; planned+=r.planned; run+=r.run; npt+=r.npt; out+=r.out; good+=r.good; target+=r.target;
    idealOut += r.ideal*(cfg.perfBasis==="crush"?r.crush:r.out);
  }
  var ppt=op-planned;
  var A= ppt>0? run/ppt : 0;
  var P= run>0? idealOut/run : 0;
  var Q= out>0? good/out : 0;
  return {op:op,planned:planned,ppt:ppt,run:run,npt:npt,out:out,good:good,target:target,A:A,P:P,Q:Q,OEE:A*P*Q};
}

function buildDashboard(prTexts, bdTexts, cfg){
  var col=cfg.col, bdCol=cfg.bdCol;
  var recs=[];
  for(var t=0;t<prTexts.length;t++){
    var rows=parseCSV(prTexts[t]);
    for(var i=1;i<rows.length;i++){ var r=rows[i]; if(!r||r.length<=col.good) continue;
      var d=toDate(r[col.date]); if(!d) continue;
      var cats=[]; for(var c=0;c<11;c++) cats.push(num(r[col.nptCatStart+c]));
      var oOut=num(r[col.out]), oOp=num(r[col.op]), oRun=num(r[col.run]), oNpt=num(r[col.npt]);
      if(oOut<=0 && oOp<=0 && oRun<=0 && oNpt<=0) continue;   // skip blank/placeholder rows
      recs.push({ d:d, g:(r[cfg.groupCol]||"").trim(), sh:(r[col.shift]||"").trim(),
        out:oOut, ideal:num(r[col.ideal]), op:oOp, planned:num(r[col.planned]),
        npt:oNpt, run:oRun, good:num(r[col.good]), target:num(r[col.target]),
        crush: cfg.crushCol!=null? num(r[cfg.crushCol]) : 0, cats:cats });
    }
  }
  var bd=[];
  for(var t2=0;t2<bdTexts.length;t2++){
    var brows=parseCSV(bdTexts[t2]);
    for(var j=1;j<brows.length;j++){ var b=brows[j]; if(!b||b.length<=bdCol.min) continue;
      var dd=toDate(b[bdCol.date]); if(!dd) continue;
      if(cfg.bdSectionCol!=null){ var bs=(b[cfg.bdSectionCol]||""); if(bs.indexOf(cfg.bdSectionMatch)<0) continue; }
      bd.push({ d:dd, cat:(b[bdCol.cat]||"").trim(), reason:(b[bdCol.reason]||"").trim(), min:num(b[bdCol.min]) });
    }
  }
  if(!recs.length) return null;
  var _n=new Date(); var lastDay=new Date(_n.getFullYear(),_n.getMonth(),_n.getDate()); lastDay.setDate(lastDay.getDate()-1);
  var monthStart=new Date(lastDay.getFullYear(), lastDay.getMonth(), 1);
  var isDay=function(r){return key(r.d)===key(lastDay);};
  var isMtd=function(r){return r.d>=monthStart && r.d<=lastDay;};
  var dayRecs=recs.filter(isDay), mtdRecs=recs.filter(isMtd);
  var dayBd=bd.filter(function(b){return key(b.d)===key(lastDay) && (cfg.bdIncludePlanned||b.cat.toLowerCase().indexOf("planned")<0);});
  var mtdBd=bd.filter(function(b){return b.d>=monthStart && b.d<=lastDay && (cfg.bdIncludePlanned||b.cat.toLowerCase().indexOf("planned")<0);});

  function unplannedTotal(set){ var s=0; for(var i=0;i<set.length;i++) s+=set[i]; return s; }

  function groupBy(set, field){
    var m={}, order=[];
    for(var i=0;i<set.length;i++){ var g=set[i][field]||"(unspecified)"; if(!m[g]){m[g]=[];order.push(g);} m[g].push(set[i]); }
    return {m:m,order:order};
  }
  function losses(set){
    var m={},order=[];
    for(var i=0;i<set.length;i++){ var r=set[i].reason||"(blank)"; if(!m[r]){m[r]=0;order.push(r);} m[r]+=set[i].min; }
    var arr=order.map(function(reason){return {n:reason,v:r0(m[reason])};});
    arr.sort(function(a,b){return b.v-a.v;});
    return arr;
  }
  function categories(set){
    var sums=new Array(11); for(var i=0;i<11;i++) sums[i]=0;
    for(var j=0;j<set.length;j++){ for(var c=0;c<11;c++) sums[c]+=set[j].cats[c]; }
    var arr=[]; for(var c2=0;c2<11;c2++){ if(sums[c2]>0) arr.push({n:CAT[c2],v:r0(sums[c2])}); }
    arr.sort(function(a,b){return b.v-a.v;}); return arr;
  }
  function opp(groupsSet){
    var rows=[],tMin=0,tMT=0;
    groupsSet.order.forEach(function(name){
      var set=groupsSet.m[name], npt=0, lost=0, om=0, out=0;
      for(var i=0;i<set.length;i++){ npt+=set[i].npt; out+=set[i].out; om+=set[i].ideal*set[i].out; if(set[i].ideal>0) lost+=set[i].npt/set[i].ideal; }
      var cyc= out>0? om/out : 0;
      rows.push({mill:name,min:r0(npt),cyc:Math.round(cyc*1000)/1000,mt:r0(lost)});
      tMin+=npt; tMT+=lost;
    });
    return {rows:rows,totalMin:r0(tMin),totalMT:r0(tMT)};
  }
  function shiftArr(set){
    var g=groupBy(set,"sh");
    return g.order.map(function(name){ var a=aggSet(g.m[name],cfg);
      var oo=a.out; if(cfg.cardMetric==="crush"){ oo=0; g.m[name].forEach(function(x){oo+=x.crush;}); }
      return {n:"Shift "+name,v:r1(a.OEE*100),A:r1(a.A*100),P:r1(a.P*100),Q:r1(a.Q*100),Out:r0(oo)}; });
  }
  function millArr(groupsSet){
    return groupsSet.order.map(function(name){ var a=aggSet(groupsSet.m[name],cfg);
      var o={n:name,v:r1(a.OEE*100),A:r1(a.A*100),P:r1(a.P*100),Q:r1(a.Q*100),out:r0(a.out),target:r0(a.target)};
      if(cfg.cardMetric==="crush"){ var cr=0; groupsSet.m[name].forEach(function(x){cr+=x.crush;}); o.crush=r0(cr); }
      return o;
    });
  }
  function boardArr(set){
    var l=losses(set).slice(0,6), out=[];
    for(var i=0;i<l.length;i++){
      var rec=null; for(var j=0;j<set.length;j++){ if((set[j].reason||"(blank)")===l[i].n){rec=set[j];break;} }
      var cat=rec?rec.cat:"";
      out.push({ p:"P"+(i+1), pcls: i<2?"t-red":(i<4?"t-amber":"t-green"),
        reason:l[i].n, sub:"", min:l[i].v, mill:"Both",
        action:actOf(l[i].n,cat), team:teamOf(l[i].n,cat), tcls: i<2?"t-red":(i<4?"t-amber":"t-green") });
    }
    return out;
  }

  function period(set, setBd, isDayScope){
    var a=aggSet(set,cfg);
    var g=groupBy(set,"g");
    var d=fmtD(lastDay), du=fmtDU(lastDay), mm=fmtM(lastDay);
    var plannedNpt = unplannedTotal([a.npt]); // NPT already unplanned
    var timeNote = (a.planned>0? r0(a.planned).toLocaleString()+" min planned downtime excluded; ":"")+r0(a.npt).toLocaleString()+" min unplanned (NPT).";
    var lossesArr=losses(setBd).slice(0,6);
    var catsArr=categories(set).slice(0,6);
    var board=boardArr(setBd);
    var _ordMin=0, _ordMap={}, _ordTop=null;
    for(var _bi=0;_bi<setBd.length;_bi++){ var _b=setBd[_bi]; var _nm=((_b.reason||"")+" "+(_b.cat||"")); if(/order|sales/i.test(_nm)){ _ordMin+=_b.min; _ordMap[_b.reason]=(_ordMap[_b.reason]||0)+_b.min; } }
    for(var _k in _ordMap){ if(!_ordTop || _ordMap[_k]>_ordMap[_ordTop]) _ordTop=_k; }
    var _prOrd=0; for(var _si=0;_si<set.length;_si++){ _prOrd+=set[_si].cats[0]; }
    var oppo=opp(g);
    var shifts=shiftArr(set);
    var bestShift=shifts.slice().sort(function(x,y){return y.v-x.v;})[0];
    var fact=[{n:"Availability",v:r1(a.A*100),t:cfg.targets.A},{n:"Performance",v:r1(a.P*100),t:cfg.targets.P},{n:"Quality",v:r1(a.Q*100),t:cfg.targets.Q}];
    var worst=fact[0], wg=-999; fact.forEach(function(f){ if((f.t-f.v)>wg){wg=f.t-f.v; worst=f;} });
    var scope = isDayScope? d : mm;
    var scopeU = isDayScope? du : (MON[lastDay.getMonth()].toUpperCase()+" "+lastDay.getFullYear()+" MTD");
    var totNpt = r0(a.npt);
    var note = (setBd.length? "" : "No unplanned breakdown events recorded in the Breakdown tab for this period.");
    var _crushTot=0; for(var _i=0;_i<set.length;_i++){_crushTot+=set[_i].crush;}
    var prodText = cfg.cardMetric==="crush" ? ("Crushing input "+r0(_crushTot).toLocaleString()+" "+cfg.units) : ("Out "+r0(a.out).toLocaleString()+"/"+r0(a.target).toLocaleString()+" "+cfg.units+" ("+(a.target>0? r1(a.out/a.target*100):0)+"%)");
    return {
      empty: set.length===0, scopeLabel: scope,
      orderMin: r0(Math.max(_prOrd,_ordMin)), orderTop: (_prOrd>=_ordMin ? "Unavailable Order" : _ordTop),
      basis: (isDayScope? "Basis: single day \u2014 "+du : "Basis: 01\u2013"+pad2(lastDay.getDate())+" "+MON[lastDay.getMonth()]+" "+lastDay.getFullYear()+" month-to-date"),
      kpiTitle:"CURRENT SCENARIO \u2014 OEE ("+(isDayScope? du.toUpperCase() : MON[lastDay.getMonth()].toUpperCase()+" "+lastDay.getFullYear()+" MTD")+")",
      kpi:{A:r1(a.A*100),P:r1(a.P*100),Q:r1(a.Q*100),OEE:r1(a.OEE*100)},
      targets:cfg.targets,
      timeTitle:"Where is time going? \u2014 "+scope,
      time:{planned:r0(a.ppt),avail:r0(a.run),down:r0(a.npt),availPct:r1(a.A*100),downPct:r1(100-a.A*100),note:timeNote},
      millsTitle:cfg.groupTitle+" \u2014 "+scope,
      mills:millArr(g),
      factorsTitle:"Find the bottleneck \u2014 "+scope,
      factors:fact,
      lossTitle:"Top downtime \u2014 "+scope+" (min)",
      losses:lossesArr.length?lossesArr:[{n:"(none recorded)",v:0}],
      lossNote:"Total unplanned NPT <b>"+ (isDayScope? r0(a.npt): r0(a.npt)) +" min</b>. "+(setBd.length?"":"Breakdown tab has no unplanned entries for this period."),
      catTitle:"Downtime by category \u2014 "+scope+" (min)",
      cats:catsArr.length?catsArr:[{n:"(none)",v:0}],
      catNote:"Unplanned NPT only \u2014 planned downtime excluded from availability.",
      boardTitle:"Shift Action Board \u2014 downtime reasons ("+scope+")",
      boardNote:"Total unplanned NPT ("+scope+") = "+totNpt.toLocaleString()+" min."+(setBd.length?"":" Breakdown tab not updated for this period."),
      board:board.length?board:[{p:"\u2014",pcls:"t-green",reason:"No unplanned breakdown recorded",sub:"",min:0,mill:"\u2014",action:"Routine monitoring; keep logging breakdowns.",team:"Operations",tcls:"t-green"}],
      shiftTitle:"Shift OEE \u2014 "+scope,
      shifts:shifts,
      quant: r0(a.npt).toLocaleString()+" min unplanned (NPT) "+(isDayScope?"on "+d:"this month")+(bestShift?(". Best shift "+bestShift.n.replace("Shift ","")+" ("+bestShift.v+"%)."):"")+" Constraint: "+worst.n+".",
      prod:{text:prodText},
      opp:{ rows:oppo.rows, totalMin:oppo.totalMin, totalMT:oppo.totalMT, plannedMin:0, plannedMT:0,
        note:"Opportunity loss = NPT min \u00f7 ideal cycle time (avg min/"+cfg.units+") \u2192 <b>~"+oppo.totalMT.toLocaleString()+" "+cfg.units+"</b> lost "+(isDayScope?"on "+d:"this month")+"." }
    };
  }

  var day=period(dayRecs, dayBd, true);
  var mtd=period(mtdRecs, mtdBd, false);

  // trend: last 16 days
  var labels=[], outs=[], oees=[];
  var start=new Date(lastDay.getTime()); start.setDate(start.getDate()-15);
  for(var s=new Date(start.getTime()); s<=lastDay; s.setDate(s.getDate()+1)){
    var set=recs.filter(function(r){return key(r.d)===key(s);});
    labels.push(fmtD(s));
    if(!set.length){ outs.push(0); oees.push(0); continue; }
    var a=aggSet(set,cfg); var oo=a.out; if(cfg.cardMetric==="crush"){ oo=0; set.forEach(function(x){oo+=x.crush;}); }
    outs.push(r0(oo)); oees.push(r1(a.OEE*100));
  }
  return { day:day, mtd:mtd, trend:{labels:labels,out:outs,oee:oees}, lastDay:lastDay };
}

if(typeof window!=="undefined"){ window.buildDashboard=buildDashboard; }
if(typeof module!=="undefined" && module.exports){ module.exports={buildDashboard:buildDashboard, parseCSV:parseCSV}; }
})();
