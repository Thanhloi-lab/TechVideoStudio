/* esm.sh - animejs@4.5.0/easings/spring */
var T=typeof window<"u",y=T?window:null;var _={NUMBER:0,UNIT:1,COLOR:2,COMPLEX:3};var M={replace:0,none:1,blend:2};var h=1e-11;var u=1e3,B=240;var d=()=>{},V=t=>t;var Y={id:null,keyframes:null,playbackEase:null,playbackRate:1,frameRate:B,loop:0,reversed:!1,alternate:!1,autoplay:!0,persist:!1,duration:u,delay:0,loopDelay:0,ease:"out(2)",composition:M.replace,modifier:V,onBegin:d,onBeforeUpdate:d,onUpdate:d,onLoop:d,onPause:d,onComplete:d,onRender:d};var l={defaults:Y,precision:4,timeScale:1,tickThreshold:200,editor:null},Z={version:"4.5.0",engine:null};T&&(y.AnimeJS||(y.AnimeJS=[]),y.AnimeJS.push(Z));var ss=Date.now;var x=t=>typeof t>"u";var F=Math.pow,g=Math.sqrt,U=Math.sin,k=Math.cos,X=Math.abs,R=Math.exp;var b=Math.PI,$=Math.round,e=(t,s,n)=>t<s?s:t>n?n:t,p=(t,s)=>{if(s<0)return t;if(!s)return $(t);let n=10**s;return $(t*n)/n};var r=(t,s)=>x(t)?s:t;var J=()=>({t:_.NUMBER,n:0,u:null,o:null,d:null,s:null});var Ps=J();var i=u*10,w=class{constructor(s={}){let n=!x(s.bounce)||!x(s.duration);this.timeStep=.02,this.restThreshold=5e-4,this.restDuration=200,this.maxDuration=6e4,this.maxRestSteps=this.restDuration/this.timeStep/u,this.maxIterations=this.maxDuration/this.timeStep/u,this.bn=e(r(s.bounce,.5),-1,1),this.pd=e(r(s.duration,628),10*l.timeScale,i*l.timeScale),this.m=e(r(s.mass,1),1,i),this.s=e(r(s.stiffness,100),h,i),this.d=e(r(s.damping,10),h,i),this.v=e(r(s.velocity,0),-i,i),this.w0=0,this.zeta=0,this.wd=0,this.b=0,this.completed=!1,this.solverDuration=0,this.settlingDuration=0,this.parent=null,this.onComplete=s.onComplete||d,n&&this.calculateSDFromBD(),this.compute(),this.ease=c=>{let f=c*this.settlingDuration,a=this.completed,o=this.pd;return f>=o&&!a&&(this.completed=!0,this.onComplete(this.parent)),f<o&&a&&(this.completed=!1),c===0||c===1?c:this.solve(c*this.solverDuration)}}solve(s){let{zeta:n,w0:c,wd:f,b:a}=this,o=s;return n<1?o=R(-o*n*c)*(1*k(f*o)+a*U(f*o)):n===1?o=(1+a*o)*R(-o*c):o=((1+a)*R((-n*c+f)*o)+(1-a)*R((-n*c-f)*o))/2,1-o}calculateSDFromBD(){let s=l.timeScale===1?this.pd/u:this.pd;this.m=1,this.v=0,this.s=F(2*b/s,2),this.bn>=0?this.d=(1-this.bn)*4*b/s:this.d=4*b/(s*(1+this.bn)),this.s=p(e(this.s,h,i),3),this.d=p(e(this.d,h,300),3)}calculateBDFromSD(){let s=2*b/g(this.s);this.pd=s*(l.timeScale===1?u:1),this.d/(2*g(this.s))<=1?this.bn=1-this.d*s/(4*b):this.bn=4*b/(this.d*s)-1,this.bn=p(e(this.bn,-1,1),3),this.pd=p(e(this.pd,10*l.timeScale,i*l.timeScale),3)}compute(){let{maxRestSteps:s,maxIterations:n,restThreshold:c,timeStep:f,m:a,d:o,s:E,v:C}=this,S=this.w0=e(g(E/a),h,u),m=this.zeta=o/(2*g(E*a));m<1?(this.wd=S*g(1-m*m),this.b=(m*S+-C)/this.wd):m===1?(this.wd=0,this.b=-C+S):(this.wd=S*g(m*m-1),this.b=(m*S+-C)/this.wd);let v=0,A=0,D=0;for(;A<=s&&D<=n;)X(1-this.solve(v))<c?A++:A=0,this.solverDuration=v,v+=f,D++;this.settlingDuration=p(this.solverDuration*u,0)*l.timeScale}get bounce(){return this.bn}set bounce(s){this.bn=e(r(s,1),-1,1),this.calculateSDFromBD(),this.compute()}get duration(){return this.pd}set duration(s){this.pd=e(r(s,1),10*l.timeScale,i*l.timeScale),this.calculateSDFromBD(),this.compute()}get stiffness(){return this.s}set stiffness(s){this.s=e(r(s,100),h,i),this.calculateBDFromSD(),this.compute()}get damping(){return this.d}set damping(s){this.d=e(r(s,10),h,i),this.calculateBDFromSD(),this.compute()}get mass(){return this.m}set mass(s){this.m=e(r(s,1),1,i),this.compute()}get velocity(){return this.v}set velocity(s){this.v=e(r(s,0),-i,i),this.compute()}},Is=t=>new w(t),Ks=t=>(console.warn("createSpring() is deprecated use spring() instead"),new w(t));export{w as Spring,Ks as createSpring,Is as spring};
/*! Bundled license information:

animejs/dist/modules/core/consts.js:
animejs/dist/modules/core/globals.js:
animejs/dist/modules/core/helpers.js:
animejs/dist/modules/core/transforms.js:
animejs/dist/modules/core/colors.js:
animejs/dist/modules/core/values.js:
  (**
   * Anime.js - core - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)

animejs/dist/modules/adapters/registry.js:
  (**
   * Anime.js - adapters - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)

animejs/dist/modules/easings/spring/index.js:
  (**
   * Anime.js - easings - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)
*/