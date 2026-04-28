import { configure, Look, DofusSprite, type DataConfig } from '../src';
import { decodeImage, createCanvas, saveToPng} from '../src/headless/export';

const config: DataConfig = {strategy: 'url', basePath: 'https://cdn.example.com/assets/', decodeImage}
// or
// const config: DataConfig = {strategy: 'fs', basePath: 'AssetPath', decodeImage}

configure(config);
const canvas = createCanvas();
const sprite = await DofusSprite.create(Look.fromString('{1|120,2195,3042,3069,3963|1=16777215,2=15335424,3=15335424,4=16777215,5=0,6=15335424|56}'), canvas, {numberFrame:1});
await sprite.prepareAnimation('AnimStatiqueExplo0_1', 4, true);
sprite.renderFrame(0);
await saveToPng(canvas, 'test.png');
