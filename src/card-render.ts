import './location-shim'
import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import encodeJpeg, { init as initJpeg } from '@jsquash/jpeg/encode'
import jpegWasm from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm'
import satori, { init as initSatori } from 'satori/wasm'
import initYoga from 'yoga-wasm-web'
import yogaWasm from 'yoga-wasm-web/dist/yoga.wasm'
import italicExt from '@fontsource/eb-garamond/files/eb-garamond-latin-ext-400-italic.woff'
import regularExt from '@fontsource/eb-garamond/files/eb-garamond-latin-ext-400-normal.woff'
import italic from '@fontsource/eb-garamond/files/eb-garamond-latin-400-italic.woff'
import regular from '@fontsource/eb-garamond/files/eb-garamond-latin-400-normal.woff'
import { CARD_FONT, CARD_FONT_EXT, CARD_SIZE, cardTree, type CardContent } from './card'

// Kept apart from card.ts because it imports WebAssembly, which only the Worker's bundler can load.
const fonts = [
  { name: CARD_FONT, data: regular, weight: 400 as const, style: 'normal' as const },
  { name: CARD_FONT_EXT, data: regularExt, weight: 400 as const, style: 'normal' as const },
  { name: CARD_FONT, data: italic, weight: 400 as const, style: 'italic' as const },
  { name: CARD_FONT_EXT, data: italicExt, weight: 400 as const, style: 'italic' as const },
]

let ready: Promise<void> | null = null
function setup(): Promise<void> {
  ready ??= (async () => {
    initSatori(await initYoga(yogaWasm as unknown as BufferSource))
    await Promise.all([initWasm(resvgWasm), initJpeg(jpegWasm)])
  })().catch((error) => {
    ready = null
    throw error
  })
  return ready
}

/** Draws the card and returns it as a JPEG, 1080 x 1080. */
export async function renderCard(card: CardContent): Promise<Uint8Array> {
  await setup()
  const svg = await satori(cardTree(card) as never, { width: CARD_SIZE, height: CARD_SIZE, fonts })
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: CARD_SIZE } })
  const image = resvg.render()
  try {
    const pixels = new Uint8ClampedArray(image.pixels)
    return new Uint8Array(await encodeJpeg({ data: pixels, width: image.width, height: image.height } as unknown as Parameters<typeof encodeJpeg>[0], { quality: 92 }))
  } finally {
    image.free()
    resvg.free()
  }
}
