import { configure, Look, DofusSprite, decodeImage, createCanvas, saveToPng, type DataConfig } from '../src/headless';

const config: DataConfig = {strategy: 'url', basePath: 'https://static.souff.fr/', decodeImage}
// or
// const config: DataConfig = {strategy: 'fs', basePath: 'AssetPath', decodeImage}

configure(config);
const canvas = createCanvas();
const sprite = await DofusSprite.create(Look.fromString('{1|3963|3=15335424}'), canvas);
sprite.renderSkinAsset(-1, "Bouclier_1",5);
await saveToPng(canvas, 'test.png');
