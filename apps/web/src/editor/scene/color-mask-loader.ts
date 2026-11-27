import { Loader, type Texture, TextureLoader } from "three";

export class ColorMaskLoader extends Loader<Texture | undefined> {
  load(url: string, onLoad: (texture: Texture | undefined) => void) {
    new TextureLoader(this.manager)
      .setCrossOrigin(this.crossOrigin)
      .load(url, onLoad, undefined, () => onLoad(undefined));
  }
}
