// スマホ・タブレットでは描くものを減らして軽くする
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
export const LITE = coarse || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent || '');
