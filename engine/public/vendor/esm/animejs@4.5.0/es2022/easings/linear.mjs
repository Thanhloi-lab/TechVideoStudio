/* esm.sh - animejs@4.5.0/easings/linear */
var l=typeof window<"u",d=l?window:null;var y={replace:0,none:1,blend:2};var b=1e3,h=240;var o=()=>{},R=s=>s;var N={id:null,keyframes:null,playbackEase:null,playbackRate:1,frameRate:h,loop:0,reversed:!1,alternate:!1,autoplay:!0,persist:!1,duration:b,delay:0,loopDelay:0,ease:"out(2)",composition:y.replace,modifier:R,onBegin:o,onBeforeUpdate:o,onUpdate:o,onLoop:o,onPause:o,onComplete:o,onRender:o};var A={version:"4.5.0",engine:null};l&&(d.AnimeJS||(d.AnimeJS=[]),d.AnimeJS.push(A));var Y=Date.now;var f=s=>typeof s=="string";var S=s=>typeof s>"u";var i=s=>f(s)?parseFloat(s):s;var w=s=>s;var z=(...s)=>{let m=s.length;if(!m)return w;let u=m-1,M=s[0],T=s[u],r=[0],n=[i(M)];for(let c=1;c<u;c++){let e=s[c],t=f(e)?e.trim().split(" "):[e],p=t[0],a=t[1];r.push(S(a)?c/u:i(a)/100),n.push(i(p))}return n.push(i(T)),r.push(1),function(e){for(let t=1,p=r.length;t<p;t++){let a=r[t];if(e<=a){let g=r[t-1],x=n[t-1];return x+(n[t]-x)*(e-g)/(a-g)}}return n[n.length-1]}};export{z as linear};
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
animejs/dist/modules/easings/linear/index.js:
  (**
   * Anime.js - easings - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)
*/