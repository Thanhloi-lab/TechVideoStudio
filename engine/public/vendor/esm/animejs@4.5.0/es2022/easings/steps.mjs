/* esm.sh - animejs@4.5.0/easings/steps */
var n=typeof window<"u",c=n?window:null;var r={replace:0,none:1,blend:2};var a=1e3,i=240;var t=()=>{},l=s=>s;var b={id:null,keyframes:null,playbackEase:null,playbackRate:1,frameRate:i,loop:0,reversed:!1,alternate:!1,autoplay:!0,persist:!1,duration:a,delay:0,loopDelay:0,ease:"out(2)",composition:r.replace,modifier:l,onBegin:t,onBeforeUpdate:t,onUpdate:t,onLoop:t,onPause:t,onComplete:t,onRender:t};var m={version:"4.5.0",engine:null};n&&(c.AnimeJS||(c.AnimeJS=[]),c.AnimeJS.push(m));var A=Date.now;var d=Math.ceil,u=Math.floor;var p=(s,o,e)=>s<o?o:s>e?e:s;var V=(s=10,o)=>{let e=o?d:u;return f=>e(p(f,0,1)*s)*(1/s)};export{V as steps};
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

animejs/dist/modules/easings/steps/index.js:
  (**
   * Anime.js - easings - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)
*/