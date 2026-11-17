/* esm.sh - animejs@4.5.0/easings/irregular */
var a=typeof window<"u",r=a?window:null;var l={replace:0,none:1,blend:2};var d=1e3,u=240;var s=()=>{},p=t=>t;var M={id:null,keyframes:null,playbackEase:null,playbackRate:1,frameRate:u,loop:0,reversed:!1,alternate:!1,autoplay:!0,persist:!1,duration:d,delay:0,loopDelay:0,ease:"out(2)",composition:l.replace,modifier:p,onBegin:s,onBeforeUpdate:s,onUpdate:s,onLoop:s,onPause:s,onComplete:s,onRender:s};var b={version:"4.5.0",engine:null};a&&(r.AnimeJS||(r.AnimeJS=[]),r.AnimeJS.push(b));var B=Date.now;var m=(t,e,o)=>t<e?e:t>o?o:t;import{linear as h}from"./linear.mjs";var U=(t=10,e=1)=>{let o=[0],c=t-1;for(let n=1;n<c;n++){let f=o[n-1],i=n/c,g=(n+1)/c,x=i+(g-i)*Math.random(),y=i*(1-e)+x*e;o.push(m(y,f,1))}return o.push(1),h(...o)};export{U as irregular};
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

animejs/dist/modules/easings/irregular/index.js:
  (**
   * Anime.js - easings - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)
*/