import { api } from './api.js';
import { settings } from './store.js';
import { t } from './i18n.js';
import { RADIO_LOADER, esc, h } from './ui.js';

// Original flat illustrations inspired by these receivers/dashboard eras, rather than manufacturer replicas.
export const RADIO_PROFILES = [
  {id:'car-40',kind:'car',name:'Chevrolet Fleetline · 1948',country:'us',decade:'1940',design:'chrome'},
  {id:'car-50',kind:'car',name:'ГАЗ-21 Волга · 1956',country:'ussr',decade:'1950',design:'chrome'},
  {id:'car-60',kind:'car',name:'Citroën DS · 1965',country:'fr',decade:'1960',design:'ivory'},
  {id:'car-70',kind:'car',name:'Mercedes-Benz W123 · 1976',country:'de',decade:'1970',design:'wood'},
  {id:'car-80',kind:'car',name:'Toyota AE86 · 1983',country:'jp',decade:'1980',design:'digital'},
  {id:'car-90',kind:'car',name:'Renault Clio · 1990',country:'fr',decade:'1990',design:'digital'},
  {id:'car-00',kind:'car',name:'Volkswagen Golf IV · 2001',country:'de',decade:'2000',design:'lcd'},
  {id:'home-40',kind:'home',name:'Emerson Patriot 400 · 1940',country:'us',decade:'1940',design:'arch'},
  {id:'home-50',kind:'home',name:'Sony TR-55 · 1955',country:'jp',decade:'1950',design:'ivory'},
  {id:'home-60',kind:'home',name:'ВЭФ Спидола · 1960',country:'ussr',decade:'1960',design:'portable'},
  {id:'home-70',kind:'home',name:'Grundig Satellit 2100 · 1976',country:'de',decade:'1970',design:'portable'},
  {id:'home-80',kind:'home',name:'Sony ICF-2001 · 1980',country:'jp',decade:'1980',design:'digital'},
  {id:'home-90',kind:'home',name:'Sony ICF-SW100 · 1994',country:'jp',decade:'1990',design:'lcd'},
  {id:'home-00',kind:'home',name:'Tivoli Model One · 2000',country:'us',decade:'2000',design:'wood'},
];
export function radioProfile() {
  const kind = settings.playerMode === 'radio-car' ? 'car' : 'home';
  return RADIO_PROFILES.find((p) => p.id === settings['radioProfile' + (kind === 'car' ? 'Car' : 'Home')]) || RADIO_PROFILES.find((p) => p.kind === kind && p.decade === settings.radioDecade) || RADIO_PROFILES.find((p) => p.kind === kind);
}
const select = (key, label, choices) => `<label class="group__item look-field"><span>${esc(label)}</span><select data-radio-setting="${key}">${choices.map(([v,label])=>`<option value="${v}" ${settings[key]===v ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`;
export function radioSettings() {
  const profile = radioProfile(), key = profile.kind === 'car' ? 'radioProfileCar' : 'radioProfileHome';
  return `<section class="group"><div class="group__label">${esc(t('radio_model'))}</div>
    ${select(key,t('radio_model'),RADIO_PROFILES.filter((p)=>p.kind===profile.kind).map((p)=>[p.id,p.name]))}
    ${select('radioSource',t('radio_source'),[['forYou',t('radio_source_forYou')],['era',t('radio_source_era')]])}
    ${select('radioCountry',t('radio_country'),['us','ussr','de','jp','fr'].map((v)=>[v,t('radio_'+v)]))}
    ${select('radioDecade',t('radio_decade'),['1940','1950','1960','1970','1980','1990','2000'].map((v)=>[v,v+'s']))}</section>`;
}
export async function radioTracks() {
  if (settings.radioSource !== 'era') return (await api.recommend()).tracks || [];
  return (await api.radio(settings.radioCountry,settings.radioDecade)).tracks || [];
}

export function showRadioIntro() {
  document.querySelector('.radio-intro')?.remove();
  const screen=h(`<div class="radio-intro" role="status" aria-label="${esc(t('radio_loading'))}">${RADIO_LOADER}</div>`);
  screen.dataset.radioKind=settings.playerMode;document.body.append(screen);setTimeout(()=>screen.remove(),1200);
}
