const { Jimp } = require('jimp');
const path = require('path');

async function processImages() {
  try {
    const imgPath = path.join(__dirname, '../public/img/aceddivision-Logo-Icon.png');
    const image = await Jimp.read(imgPath);

    const goldR = 222, goldG = 143, goldB = 0;
    const blackR = 0, blackG = 0, blackB = 0;
    const creamR = 243, creamG = 241, creamB = 236;
    const emberR = 232, emberG = 169, emberB = 96;

    // Clone for on-dark
    const onDark = image.clone();
    onDark.scan(0, 0, onDark.bitmap.width, onDark.bitmap.height, function(x, y, idx) {
      const r = this.bitmap.data[idx + 0];
      const g = this.bitmap.data[idx + 1];
      const b = this.bitmap.data[idx + 2];
      const a = this.bitmap.data[idx + 3];

      if (a > 0) {
        const distGold = Math.sqrt(Math.pow(r - goldR, 2) + Math.pow(g - goldG, 2) + Math.pow(b - goldB, 2));
        const distBlack = Math.sqrt(Math.pow(r - blackR, 2) + Math.pow(g - blackG, 2) + Math.pow(b - blackB, 2));

        if (distGold < distBlack) {
          this.bitmap.data[idx + 0] = emberR;
          this.bitmap.data[idx + 1] = emberG;
          this.bitmap.data[idx + 2] = emberB;
        } else {
          this.bitmap.data[idx + 0] = creamR;
          this.bitmap.data[idx + 1] = creamG;
          this.bitmap.data[idx + 2] = creamB;
        }
      }
    });
    onDark.write(path.join(__dirname, '../public/img/aceddivision-Logo-Icon-OnDark.png'));

    // Clone for solid gold
    const onGold = image.clone();
    onGold.scan(0, 0, onGold.bitmap.width, onGold.bitmap.height, function(x, y, idx) {
      const a = this.bitmap.data[idx + 3];
      if (a > 0) {
        this.bitmap.data[idx + 0] = 201;
        this.bitmap.data[idx + 1] = 150;
        this.bitmap.data[idx + 2] = 44;
      }
    });
    onGold.write(path.join(__dirname, '../public/img/aceddivision-Logo-Icon-Gold.png'));

    console.log("Images generated successfully.");
  } catch (err) {
    console.error(err);
  }
}

processImages();
