/* esm.sh - animejs@4.5.0/easings/cubic-bezier */
var a=typeof window<"u",i=a?window:null;var d={replace:0,none:1,blend:2};var u=1e3,p=240;var o=()=>{},f=s=>s;var M={id:null,keyframes:null,playbackEase:null,playbackRate:1,frameRate:p,loop:0,reversed:!1,alternate:!1,autoplay:!0,persist:!1,duration:u,delay:0,loopDelay:0,ease:"out(2)",composition:d.replace,modifier:f,onBegin:o,onBeforeUpdate:o,onUpdate:o,onLoop:o,onPause:o,onComplete:o,onRender:o};var y={version:"4.5.0",engine:null};a&&(i.AnimeJS||(i.AnimeJS=[]),i.AnimeJS.push(y));var k=Date.now;var m=Math.abs;var g=s=>s;var x=(s,t,e)=>(((1-3*e+3*t)*s+(3*e-6*t))*s+3*t)*s,R=(s,t,e)=>{let r=0,n=1,l,c,b=0;do c=r+(n-r)/2,l=x(c,t,e)-s,l>0?n=c:r=c;while(m(l)>1e-7&&++b<100);return c},z=(s=.5,t=0,e=.5,r=1)=>s===t&&e===r?g:n=>n===0||n===1?n:x(R(n,s,e),t,r);export{z as cubicBezier};
/*! Bundled license information:

animejs/dist/modules/core/consts.js:
animejs/dist/modules/core/globals.js:
animejs/dist/modules/core/helpers.js:
  (**
   * Anime.js - core - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)

animejs/dist/modules/easings/none.js:
animejs/dist/modules/easings/cubic-bezier/index.js:
  (**
   * Anime.js - easings - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)
*/