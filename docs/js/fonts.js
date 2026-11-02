export const TYPEFACES = { navy:'Cormorant Garamond',noir:'Oswald',bordo:'PT Serif',green:'PT Serif Caption',richesse:'Cormorant',obsidian:'Manrope',terracotta:'Alegreya',tuscan:'Merriweather',ussr:'Russo One',ddr:'Roboto Condensed',eighties:'Rubik Mono One',depression:'Bitter' };
export function loadTypeface(theme) {
  const face=TYPEFACES[theme]; if(!face)return;
  const id='font-'+theme;
  if(document.getElementById(id))return face;
  const link=document.createElement('link');link.id=id;link.rel='stylesheet';link.href=`https://fonts.googleapis.com/css2?family=${encodeURIComponent(face).replaceAll('%20','+')}&display=swap`;document.head.append(link);
  return face;
}
