/* esm.sh - animejs@4.5.0/easings */
import{cubicBezier as es}from"./easings/cubic-bezier.mjs";import{steps as os}from"./easings/steps.mjs";import{linear as rs}from"./easings/linear.mjs";import{irregular as as}from"./easings/irregular.mjs";import{Spring as ls,createSpring as ds,spring as ps}from"./easings/spring.mjs";var l=typeof window<"u",d=l?window:null;var y={replace:0,none:1,blend:2};var u=1e-11;var b=1e3,h=240,f="";var o=()=>{},S=s=>s;var I={id:null,keyframes:null,playbackEase:null,playbackRate:1,frameRate:h,loop:0,reversed:!1,alternate:!1,autoplay:!0,persist:!1,duration:b,delay:0,loopDelay:0,ease:"out(2)",composition:y.replace,modifier:S,onBegin:o,onBeforeUpdate:o,onUpdate:o,onLoop:o,onPause:o,onComplete:o,onRender:o};var A={version:"4.5.0",engine:null};l&&(d.AnimeJS||(d.AnimeJS=[]),d.AnimeJS.push(A));var Z=Date.now;var r=Math.pow,w=Math.sqrt,R=Math.sin,E=Math.cos;var T=Math.asin;var m=Math.PI;var x=(s,e,t)=>s<e?e:s>t?t:s;var g=s=>s;var a=(s=1.68)=>e=>r(e,+s),M={in:s=>e=>s(e),out:s=>e=>1-s(1-e),inOut:s=>e=>e<.5?s(e*2)/2:1-s(e*-2+2)/2,outIn:s=>e=>e<.5?(1-s(1-e*2))/2:(s(e*2-1)+1)/2},O=m/2,C=m*2,_={[f]:a,Quad:a(2),Cubic:a(3),Quart:a(4),Quint:a(5),Sine:s=>1-E(s*O),Circ:s=>1-w(1-s*s),Expo:s=>s?r(2,10*s-10):0,Bounce:s=>{let e,t=4;for(;s<((e=r(2,--t))-1)/11;);return 1/r(4,3-t)-7.5625*r((e*3-2)/22-s,2)},Back:(s=1.7)=>e=>(+s+1)*e*e*e-+s*e*e,Elastic:(s=1,e=.3)=>{let t=x(+s,1,10),c=x(+e,u,2),i=c/C*T(1/t),p=C/c;return n=>n===0||n===1?n:-t*r(2,-10*(1-n))*R((1-n-i)*p)}},B=(()=>{let s={linear:g,none:g};for(let e in M)for(let t in _){let c=_[t],i=M[e];s[e+t]=t===f||t==="Back"||t==="Elastic"?(p,n)=>i(c(p,n)):i(c)}return s})();export{ls as Spring,ds as createSpring,es as cubicBezier,B as eases,as as irregular,rs as linear,ps as spring,os as steps};
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
animejs/dist/modules/easings/eases/parser.js:
animejs/dist/modules/easings/index.js:
  (**
   * Anime.js - easings - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)
*/