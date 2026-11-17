/* esm.sh - animejs@4.5.0/svg */
var d=typeof window<"u",R=d?window:null,D=d?document:null;var F={replace:0,none:1,blend:2};var L=Symbol();var I=Symbol();var A=1e3,B=240;var g=()=>{},U=t=>t;var st={id:null,keyframes:null,playbackEase:null,playbackRate:1,frameRate:B,loop:0,reversed:!1,alternate:!1,autoplay:!0,persist:!1,duration:A,delay:0,loopDelay:0,ease:"out(2)",composition:F.replace,modifier:U,onBegin:g,onBeforeUpdate:g,onUpdate:g,onLoop:g,onPause:g,onComplete:g,onRender:g},j={current:null,root:D};var q={version:"4.5.0",engine:null};d&&(R.AnimeJS||(R.AnimeJS=[]),R.AnimeJS.push(q));var ut=Date.now,P=Array.isArray;var G=t=>typeof t=="string",Y=t=>typeof t=="function",z=t=>typeof t>"u",C=t=>z(t)||t===null,E=t=>d&&t instanceof SVGElement;var k=Math.sqrt;var $=Math.atan2,H=Math.PI,X=Math.round;var _=(t,o)=>{if(o<0)return t;if(!o)return X(t);let e=10**o;return X(t*e)/e};function Z(t){let o=G(t)?j.root.querySelectorAll(t):t;if(o instanceof NodeList||o instanceof HTMLCollection)return o}function N(t){if(C(t))return[];if(!d)return P(t)&&t.flat(1/0)||[t];if(P(t)){let e=t.flat(1/0),s=[];for(let a=0,p=e.length;a<p;a++){let i=e[a];if(!C(i)){let c=Z(i);if(c)for(let f=0,n=c.length;f<n;f++){let l=c[f];if(!C(l)){let r=!1;for(let m=0,x=s.length;m<x;m++)if(s[m]===l){r=!0;break}r||s.push(l)}}else{let f=!1;for(let n=0,l=s.length;n<l;n++)if(s[n]===i){f=!0;break}f||s.push(i)}}}return s}let o=Z(t);return o?Array.from(o):[t]}var v=t=>{let e=N(t)[0];return!e||!E(e)?console.warn(`${t} is not a valid SVGGeometryElement`):e};var O=(t,o,e,s,a)=>{let p=e+s,i=a?Math.max(0,Math.min(p,o)):(p%o+o)%o;return t.getPointAtLength(i)},V=(t,o,e=0)=>s=>{let a=+t.getTotalLength(),p=s[L],i=t.getCTM(),c=e===0;return{from:0,to:a,modifier:f=>{let n=e*a,l=f+n;if(o==="a"){let r=O(t,a,l,-1,c),m=O(t,a,l,1,c);return $(m.y-r.y,m.x-r.x)*180/H}else{let r=O(t,a,l,0,c);return o==="x"?p||!i?r.x:r.x*i.a+r.y*i.c+i.e:p||!i?r.y:r.x*i.b+r.y*i.d+i.f}}}},J=(t,o=0)=>{let e=v(t);if(e)return{translateX:V(e,"x",o),translateY:V(e,"y",o),rotate:V(e,"a",o)}};var K=t=>{let o=1;if(t&&t.getCTM){let e=t.getCTM();if(e){let s=k(e.a*e.a+e.b*e.b),a=k(e.c*e.c+e.d*e.d);o=(s+a)/2}}return o},W=(t,o,e)=>{let s=A,a=getComputedStyle(t),p=a.strokeLinecap,i=a.vectorEffect==="non-scaling-stroke"?t:null,c=p,f=new Proxy(t,{get(n,l){let r=n[l];return l===I?n:l==="setAttribute"?(...m)=>{if(m[0]==="draw"){let S=m[1].split(" "),y=+S[0],h=+S[1],u=K(i),w=y*-s*u,T=h*s*u+w,M=s*u+(y===0&&h===1||y===1&&h===0?0:10*u)-T;if(p!=="butt"){let b=y===h?"butt":p;c!==b&&(n.style.strokeLinecap=`${b}`,c=b)}n.setAttribute("stroke-dashoffset",`${w}`),n.setAttribute("stroke-dasharray",`${T} ${M}`)}return Reflect.apply(r,n,m)}:Y(r)?(...m)=>Reflect.apply(r,n,m):r}});return t.getAttribute("pathLength")!==`${s}`&&(t.setAttribute("pathLength",`${s}`),f.setAttribute("draw",`${o} ${e}`)),f},Q=(t,o=0,e=0)=>N(t).map(a=>W(a,o,e));var tt=(t,o=.33)=>(e,s,a,p)=>{if(!(e.tagName||"").toLowerCase().match(/^(path|polygon|polyline)$/))throw new Error(`Can't morph a <${e.tagName}> SVG element. Use <path>, <polygon> or <polyline>.`);let c=v(t);if(!c)throw new Error("Can't morph to an invalid target. 'path2' must resolve to an existing <path>, <polygon> or <polyline> SVG element.");if(!(c.tagName||"").toLowerCase().match(/^(path|polygon|polyline)$/))throw new Error(`Can't morph a <${c.tagName}> SVG element. Use <path>, <polygon> or <polyline>.`);let n=e.tagName==="path",l=n?" ":",",r=p?p._value:null;r&&e.setAttribute(n?"d":"points",r);let m="",x="";if(!o)m=e.getAttribute(n?"d":"points"),x=c.getAttribute(n?"d":"points");else{let S=e.getTotalLength(),y=c.getTotalLength(),h=Math.max(Math.ceil(S*o),Math.ceil(y*o));for(let u=0;u<h;u++){let w=u/(h-1),T=e.getPointAtLength(S*w),M=c.getPointAtLength(y*w),b=n?u===0?"M":"L":"";m+=b+_(T.x,3)+l+T.y+" ",x+=b+_(M.x,3)+l+M.y+" "}}return[m,x]};export{Q as createDrawable,J as createMotionPath,tt as morphTo};
/*! Bundled license information:

animejs/dist/modules/core/consts.js:
animejs/dist/modules/core/globals.js:
animejs/dist/modules/core/helpers.js:
animejs/dist/modules/core/targets.js:
  (**
   * Anime.js - core - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)

animejs/dist/modules/svg/helpers.js:
animejs/dist/modules/svg/motionpath.js:
animejs/dist/modules/svg/drawable.js:
animejs/dist/modules/svg/morphto.js:
animejs/dist/modules/svg/index.js:
  (**
   * Anime.js - svg - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)
*/