/* esm.sh - animejs@4.5.0/text */
var q=typeof window<"u",_e=q?window:null,w=q?document:null;var Te={NUMBER:0,UNIT:1,COLOR:2,COMPLEX:3};var ae={replace:0,none:1,blend:2};var Z=1e-11;var ge=1e3,Fe=240,ee="";var E=()=>{},it=e=>e;var Oe={id:null,keyframes:null,playbackEase:null,playbackRate:1,frameRate:Fe,loop:0,reversed:!1,alternate:!1,autoplay:!0,persist:!1,duration:ge,delay:0,loopDelay:0,ease:"out(2)",composition:ae.replace,modifier:it,onBegin:E,onBeforeUpdate:E,onUpdate:E,onLoop:E,onPause:E,onComplete:E,onRender:E},te={current:null,root:w},L={defaults:Oe,precision:4,timeScale:1,tickThreshold:200,editor:null},at={version:"4.5.0",engine:null};q&&(_e.AnimeJS||(_e.AnimeJS=[]),_e.AnimeJS.push(at));var ye=(e,t)=>e.indexOf(t)===0,Be=Date.now,Ve=Array.isArray,ve=e=>e&&e.constructor===Object,ct=e=>typeof e=="number"&&!isNaN(e),Y=e=>typeof e=="string",I=e=>typeof e=="function",$=e=>typeof e>"u";var K=Math.pow,ut=Math.sqrt,dt=Math.sin,ft=Math.cos;var ht=Math.asin;var Ue=Math.PI,lt=Math.round,le=(e,t,s)=>e<t?t:e>s?s:e,F=(e,t)=>{if(t<0)return e;if(!t)return lt(e);let s=10**t;return lt(e*s)/s};function pt(e){let t=Y(e)?te.root.querySelectorAll(e):e;if(t instanceof NodeList||t instanceof HTMLCollection)return t}var G=(e,t)=>$(e)?t:e;var Ut=()=>({t:Te.NUMBER,n:0,u:null,o:null,d:null,s:null});var kt=Ut();var Tt=e=>{let t;return((...s)=>{let o,n,a,l,p;t&&(o=t.currentIteration,n=t.iterationProgress,a=t.reversed,l=t._alternate,p=t._startTime,t.revert());let i=e(...s);return i&&!I(i)&&i.revert&&(t=i),$(n)||(t.currentIteration=o,t.iterationProgress=(l&&o%2?!a:a)?1-n:n,t._startTime=p),i||E})};var xe=typeof Intl<"u"&&Intl.Segmenter,Jt=/\{value\}/g,Kt=/\{i\}/g,He=/(\s+)/,Je=/^\s+$/,Ke="line",ce="word",ue="char",de="data-line",We=null,ze=null,we=null,gt=e=>e.isWordLike||e.segment===" "||ct(+e.segment),Xe=e=>e.setAttribute("aria-hidden","true"),Ce=(e,t)=>[...e.querySelectorAll(`[data-${t}]:not([data-${t}] [data-${t}])`)],Gt={line:"#00D672",word:"#FF4B4B",char:"#5A87FF"},yt=e=>{if(!e.childElementCount&&!e.textContent.trim()){let t=e.parentElement;e.remove(),t&&yt(t)}},vt=(e,t,s)=>{let o=e.getAttribute(de);if(o!==null&&+o!==t||e.tagName==="BR"){s.add(e);let a=e.previousSibling,l=e.nextSibling;a&&a.nodeType===3&&Je.test(a.textContent)&&s.add(a),l&&l.nodeType===3&&Je.test(l.textContent)&&s.add(l)}let n=e.childElementCount;for(;n--;)vt(e.children[n],t,s);return s},Ze=(e,t={})=>{let s="";t||(t={});let o=Y(t.class)?` class="${t.class}"`:"",n=G(t.clone,!1),a=G(t.wrap,!1),l=a?a===!0?"clip":a:n?"clip":!1;if(a&&(s+=`<span${l?` style="overflow:${l};"`:""}>`),s+=`<span${o}${n?' style="position:relative;"':""} data-${e}="{i}">`,n){let p=n==="left"?"-100%":n==="right"?"100%":"0",i=n==="top"?"-100%":n==="bottom"?"100%":"0";s+="<span>{value}</span>",s+=`<span inert style="position:absolute;top:${i};left:${p};white-space:nowrap;">{value}</span>`}else s+="{value}";return s+="</span>",a&&(s+="</span>"),s},Ye=(e,t,s,o,n,a,l,p,i)=>{let _=n===Ke,b=n===ue,m=`_${n}_`,u=I(e)?e(s):e,T=_?"block":"inline-block";we.innerHTML=u.replace(Jt,`<i class="${m}"></i>`).replace(Kt,`${b?i:_?l:p}`);let c=we.content,f=c.firstElementChild,h=c.querySelector(`[data-${n}]`)||f,g=c.querySelectorAll(`i.${m}`),v=g.length;if(v){f.style.display=T,h.style.display=T,h.setAttribute(de,`${l}`),_||(h.setAttribute("data-word",`${p}`),b&&h.setAttribute("data-char",`${i}`));let B=v;for(;B--;){let C=g[B],D=C.parentElement;D.style.display=T,_?D.innerHTML=s.innerHTML:D.replaceChild(s.cloneNode(!0),C)}t.push(h),o.appendChild(c)}else console.warn('The expression "{value}" is missing from the provided template.');return a&&(f.style.outline=`1px dotted ${Gt[n]}`),f},fe=class{constructor(t,s={}){We||(We=xe?new xe([],{granularity:ce}):{segment:c=>{let f=[],h=c.split(He);for(let g=0,v=h.length;g<v;g++){let B=h[g];f.push({segment:B,isWordLike:!Je.test(B)})}return f}}),ze||(ze=xe?new xe([],{granularity:"grapheme"}):{segment:c=>[...c].map(f=>({segment:f}))}),!we&&q&&(we=w.createElement("template")),te.current&&te.current.register(this);let{words:o,chars:n,lines:a,accessible:l,includeSpaces:p,debug:i}=s,_=(t=Ve(t)?t[0]:t)&&t.nodeType?t:(pt(t)||[])[0],b=a===!0?{}:a,m=o===!0||$(o)?{}:o,u=n===!0?{}:n;this.debug=G(i,!1),this.includeSpaces=G(p,!1),this.accessible=G(l,!0),this.linesOnly=b&&!m&&!u,this.lineTemplate=ve(b)?Ze(Ke,b):b,this.wordTemplate=ve(m)||this.linesOnly?Ze(ce,m):m,this.charTemplate=ve(u)?Ze(ue,u):u,this.$target=_,this.html=_&&_.innerHTML,this.lines=[],this.words=[],this.chars=[],this.effects=[],this.effectsCleanups=[],this.cache=null,this.ready=!1,this.width=0,this.resizeTimeout=null;let T=()=>this.html&&(b||m||u)&&this.split();this.resizeObserver=new ResizeObserver(()=>{clearTimeout(this.resizeTimeout),this.resizeTimeout=setTimeout(()=>{let c=_.offsetWidth;c!==this.width&&(this.width=c,T())},150)}),this.lineTemplate&&!this.ready?w.fonts.ready.then(T):T(),_?this.resizeObserver.observe(_):console.warn("No Text Splitter target found.")}addEffect(t){if(!I(t))return console.warn("Effect must return a function."),this;let s=Tt(t);return this.effects.push(s),this.ready&&(this.effectsCleanups[this.effects.length-1]=s(this)),this}revert(){return clearTimeout(this.resizeTimeout),this.lines.length=this.words.length=this.chars.length=0,this.resizeObserver.disconnect(),this.effectsCleanups.forEach(t=>I(t)?t(this):t.revert&&t.revert()),this.$target.innerHTML=this.html,this}splitNode(t){let s=this.wordTemplate,o=this.charTemplate,n=this.includeSpaces,a=this.debug,l=t.nodeType;if(l===3){let p=t.nodeValue;if(p.trim()){let i=[],_=this.words,b=this.chars,m=We.segment(p),u=w.createDocumentFragment(),T=null;for(let c of m){let f=c.segment,h=gt(c);if(!T||h&&T&&gt(T))i.push(f);else{let g=i.length-1,v=i[g];!He.test(v)&&!He.test(f)?i[g]+=f:i.push(f)}T=c}for(let c=0,f=i.length;c<f;c++){let h=i[c];if(h.trim()){let g=i[c+1],v=n&&g&&!g.trim(),B=h,C=o?ze.segment(B):null,D=o?w.createDocumentFragment():w.createTextNode(v?h+"\xA0":h);if(o){let W=[...C];for(let O=0,se=W.length;O<se;O++){let z=W[O],me=O===se-1&&v?z.segment+"\xA0":z.segment,ne=w.createTextNode(me);Ye(o,b,ne,D,ue,a,-1,_.length,b.length)}}s?Ye(s,_,D,u,ce,a,-1,_.length,b.length):o?u.appendChild(D):u.appendChild(w.createTextNode(h)),v&&c++}else{if(c&&n)continue;u.appendChild(w.createTextNode(h))}}t.parentNode.replaceChild(u,t)}}else if(l===1){let p=[...t.childNodes];for(let i=0,_=p.length;i<_;i++)this.splitNode(p[i])}}split(t=!1){let s=this.$target,o=!!this.cache&&!t,n=this.lineTemplate,a=this.wordTemplate,l=this.charTemplate,p=w.fonts.status!=="loading",i=n&&p;this.ready=!n||p,(i||t)&&this.effectsCleanups.forEach(u=>I(u)&&u(this)),o||(t&&(s.innerHTML=this.html,this.words.length=this.chars.length=0),this.splitNode(s),this.cache=s.innerHTML),i&&(o&&(s.innerHTML=this.cache),this.lines.length=0,a&&(this.words=Ce(s,ce))),l&&(i||a)&&(this.chars=Ce(s,ue));let _=this.words.length?this.words:this.chars,b,m=0;for(let u=0,T=_.length;u<T;u++){let c=_[u],{top:f,height:h}=c.getBoundingClientRect();!$(b)&&f-b>h*.5&&m++,c.setAttribute(de,`${m}`);let g=c.querySelectorAll(`[${de}]`),v=g.length;for(;v--;)g[v].setAttribute(de,`${m}`);b=f}if(i){let u=w.createDocumentFragment(),T=new Set,c=[];for(let f=0;f<m+1;f++){let h=s.cloneNode(!0);vt(h,f,new Set).forEach(g=>{let v=g.parentNode;v&&(g.nodeType===1&&T.add(v),v.removeChild(g))}),c.push(h)}T.forEach(yt);for(let f=0,h=c.length;f<h;f++)Ye(n,this.lines,c[f],u,Ke,this.debug,f);s.innerHTML="",s.appendChild(u),a&&(this.words=Ce(s,ce)),l&&(this.chars=Ce(s,ue))}if(this.linesOnly){let u=this.words,T=u.length;for(;T--;){let c=u[T];c.replaceWith(c.textContent)}u.length=0}if(this.accessible&&(i||!o)){let u=w.createElement("span");u.style.cssText="position:absolute;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);width:1px;height:1px;white-space:nowrap;",u.innerHTML=this.html,s.insertBefore(u,s.firstChild),this.lines.forEach(Xe),this.words.forEach(Xe),this.chars.forEach(Xe)}return this.width=s.offsetWidth,(i||t)&&this.effects.forEach((u,T)=>this.effectsCleanups[T]=u(this)),this}refresh(){this.split(!0)}},Qt=(e,t)=>new fe(e,t),jt=(e,t)=>(console.warn("text.split() is deprecated, import splitText() directly, or text.splitText()"),new fe(e,t));var es=0,Ge=(e,t=0,s=1,o=0)=>{let n=e===void 0?es++:e;return(a=t,l=s,p=o)=>{n+=1831565813,n=Math.imul(n^n>>>15,n|1),n^=n+Math.imul(n^n>>>7,n|61);let i=10**p;return Math.floor((((n^n>>>14)>>>0)/4294967296*(l-a+1/i)+a)*i)/i}};var H=e=>e;var he=(e=1.68)=>t=>K(t,+e),je={in:e=>t=>e(t),out:e=>t=>1-e(1-t),inOut:e=>t=>t<.5?e(t*2)/2:1-e(t*-2+2)/2,outIn:e=>t=>t<.5?(1-e(1-t*2))/2:(e(t*2-1)+1)/2},ts=Ue/2,St=Ue*2,bt={[ee]:he,Quad:he(2),Cubic:he(3),Quart:he(4),Quint:he(5),Sine:e=>1-ft(e*ts),Circ:e=>1-ut(1-e*e),Expo:e=>e?K(2,10*e-10):0,Bounce:e=>{let t,s=4;for(;e<((t=K(2,--s))-1)/11;);return 1/K(4,3-s)-7.5625*K((t*3-2)/22-e,2)},Back:(e=1.7)=>t=>(+e+1)*t*t*t-+e*t*t,Elastic:(e=1,t=.3)=>{let s=le(+e,1,10),o=le(+t,Z,2),n=o/St*ht(1/s),a=St/o;return l=>l===0||l===1?l:-s*K(2,-10*(1-l))*dt((1-l-n)*a)}},Qe=(()=>{let e={linear:H,none:H};for(let t in je)for(let s in bt){let o=bt[s],n=je[t];e[t+s]=s===ee||s==="Back"||s==="Elastic"?(a,l)=>n(o(a,l)):n(o)}return e})(),Re={linear:H,none:H},ss=e=>{if(Re[e])return Re[e];if(e.indexOf("(")<=-1){let s=je[e]||e.includes("Back")||e.includes("Elastic")?Qe[e]():Qe[e];return s?Re[e]=s:H}else{let t=e.slice(0,-1).split("("),s=Qe[t[0]];return s?Re[e]=s(...t[1].split(",")):H}},xt=["steps(","irregular(","linear(","cubicBezier("],Ct=e=>{if(Y(e)){for(let s=0,o=xt.length;s<o;s++)if(ye(e,xt[s]))return console.warn(`String syntax for \`ease: "${e}"\` has been removed from the core and replaced by importing and passing the easing function directly: \`ease: ${e}\``),H}return I(e)?e:Y(e)?ss(e):H};var wt=e=>{let t="";for(let s=0,o=e.length;s<o;s++)if(s+2<o&&e[s+1]==="-"&&e.charCodeAt(s)<e.charCodeAt(s+2)){let n=e.charCodeAt(s),a=e.charCodeAt(s+2);for(let l=n;l<=a;l++)t+=String.fromCharCode(l);s+=2}else t+=e[s];return t},Rt={lowercase:"a-z",uppercase:"A-Z",numbers:"0-9",symbols:"!%#_|*+=",braille:"\u2800-\u28FF",blocks:"\u2580-\u259F",shades:"\u2591-\u2593"},et=new WeakMap,ns=(e={})=>{e||(e={});let t=e.chars,s=Ct(e.ease||"linear"),o=e.text,n=e.from,a=e.reversed||!1,l=e.perturbation||0,p=e.cursor,i=p===!0?"_":typeof p=="number"?String.fromCharCode(p):typeof p=="string"?p:"",_=i.length,b=e.seed||0,m=e.override!==void 0?e.override:!0,u=e.revealRate||60,T=1e3*L.timeScale/u,c=e.settleDuration||300*L.timeScale,f=e.settleRate||30,h=e.duration,g=e.revealDelay,v=e.delay,B=e.onChange||E;return(C,D,W,O)=>{let se=typeof t=="function"?t(C,D,W):t||"a-zA-Z0-9!%#_",z=wt(Rt[se]||se),Ae=z.length-1,me=typeof h=="function"?h(C,D,W):h,ne=typeof g=="function"?g(C,D,W):g||0,tt=typeof v=="function"?v(C,D,W):v||0,J=b?Ge(b):Ge();et.has(C)||et.set(C,C.textContent);let V=O?O._value:C.textContent,Ee=o!==void 0?typeof o=="function"?o(C,D,W):o:O?O._value:et.get(C),re=Ee===" "||Ee==="&nbsp;"?"\xA0":Ee,U=V==="\xA0"?0:V.length,M=re.length,k=m===!0?z:typeof m=="string"&&m.length>0?wt(Rt[m]||m):null,At=k?k.length-1:0,st=m===" "?"\xA0":null,y=m===""?M:Math.max(U,M),nt=me>0?me:(y-1)*T+c,De=F((nt+ne)/L.timeScale,0)*L.timeScale,Pe=ne>0?F(ne/De,12):0,X=n===void 0||n==="auto"?M<U?"right":"left":n,N=new Int32Array(y);if(X==="random"){for(let r=0;r<y;r++)N[r]=r;for(let r=y-1;r>0;r--){let S=J(0,r),A=N[r];N[r]=N[S],N[S]=A}}else{let r=X==="right"?(m===""||!U?y:U)-1:X==="center"?((m===""||!U?y:U)-1)/2:typeof X=="number"?X:0,S=Math.abs,A=new Array(y);for(let d=0;d<y;d++)A[d]=d;A.sort((d,P)=>S(d-r)-S(P-r));for(let d=0;d<y;d++)N[A[d]]=d}if(a){let r=y-1;for(let S=0;S<y;S++)N[S]=r-N[S]}let Me=F(c/nt,12),Ne=F((1-Me)/y,12),Et=_*Ne,Le=F(1e3*L.timeScale/(f*De),12),Ie=new Float32Array(y),Q=new Float32Array(y),pe=l>0?l*Me:0;for(let r=0;r<y;r++){let S=pe>0?(J(0,2e3)-1e3)/1e3*pe:0,A=pe>0?(J(0,2e3)-1e3)/1e3*pe:0;Ie[r]=N[r]*Ne+S,Q[r]=Math.ceil((Ie[r]+Me+A)/Le)*Le}if(M<y&&X!=="left"&&X!=="right"&&X!=="random"){let r=0;for(let d=M;d<y;d++)Q[d]>r&&(r=Q[d]);let S=new Array(M);for(let d=0;d<M;d++)S[d]=d;S.sort((d,P)=>N[d]-N[P]);let A=(1-r)/M;for(let d=0;d<M;d++){let P=r+d*A;P>Q[S[d]]&&(Q[S[d]]=P)}}let oe=new Array(y);for(let r=0;r<y;r++)oe[r]=z[J(0,Ae)];let j=k?k===z?oe:new Array(y):null;if(j&&j!==oe)for(let r=0;r<y;r++)j[r]=st||k[J(0,k.length-1)];let ie=V;if(!O){if(m==="")ie="";else if(k){ie="";for(let r=0;r<U;r++)ie+=V[r]===" "?" ":j[r]}}let rt=-1,ot=-1,R="",Dt=m!=="",Pt=!!k,Mt=_>0;return{from:0,to:1,duration:De,delay:tt,ease:"linear",modifier:r=>{if(r===rt)return R;if(rt=r,tt>0&&r<=0)return R=V,V;if(r<=0)return R=ie,ie;if(r>=1)return R=re,re;R="";let S=r/Le|0,A=S!==ot;A&&(ot=S);let d=Pe>0?(r-Pe)/(1-Pe):r,P=d>0?s(d):0;for(let x=0;x<y;x++){let $e=Ie[x],Nt=Q[x];if(P>=Nt){x<M&&(R+=re[x]);continue}if(P<=0||P<$e){Dt&&x<U&&(Pt?V[x]===" "?R+=" ":(A&&(j[x]=st||k[J(0,At)]),R+=j[x]):R+=V[x]);continue}x<M&&re[x]===" "||x<U&&V[x]===" "?R+=" ":Mt&&P-$e<Et?R+=i[_-1-((P-$e)/Ne|0)]:(A&&(oe[x]=z[J(0,Ae)]),R+=oe[x])}return A&&B(R,P),R}}}};export{fe as TextSplitter,ns as scrambleText,jt as split,Qt as splitText};
/*! Bundled license information:

animejs/dist/modules/core/consts.js:
animejs/dist/modules/core/globals.js:
animejs/dist/modules/core/helpers.js:
animejs/dist/modules/core/targets.js:
animejs/dist/modules/core/transforms.js:
animejs/dist/modules/core/colors.js:
animejs/dist/modules/core/values.js:
animejs/dist/modules/core/render.js:
animejs/dist/modules/core/styles.js:
animejs/dist/modules/core/clock.js:
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

animejs/dist/modules/animation/additive.js:
animejs/dist/modules/animation/composition.js:
  (**
   * Anime.js - animation - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)

animejs/dist/modules/engine/engine.js:
  (**
   * Anime.js - engine - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)

animejs/dist/modules/timer/timer.js:
  (**
   * Anime.js - timer - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)

animejs/dist/modules/utils/time.js:
animejs/dist/modules/utils/random.js:
  (**
   * Anime.js - utils - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)

animejs/dist/modules/text/split.js:
animejs/dist/modules/text/scramble.js:
animejs/dist/modules/text/index.js:
  (**
   * Anime.js - text - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)

animejs/dist/modules/easings/none.js:
animejs/dist/modules/easings/eases/parser.js:
  (**
   * Anime.js - easings - ESM
   * @version v4.5.0
   * @license MIT
   * @copyright 2026 - Julian Garnier
   *)
*/