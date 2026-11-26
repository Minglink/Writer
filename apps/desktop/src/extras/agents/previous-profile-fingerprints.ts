import type { ExtrasAgentId } from "@writer/contracts";

export const previousProfileFingerprints: Partial<
  Record<ExtrasAgentId, Record<string, readonly string[]>>
> = {
  "revision-analysis": {
    default: [
      "b5913d21edae91cdc04bddd0c94debe06b989567661dd60229ab35691ae93c37"
    ]
  },
  "style-comparison": {
    default: [
      "a0a1fd8e930184974b831772cc3debf361310bd563706ffde907b6d2fdd3e51f",
      "2e458015387a1870ea11c7bdd1389e4dac0217a03a1de62b519b3435e9ee8094"
    ]
  },
  "short-book-analysis": {
    "plot-structure": [
      "40f26e309ea2ac9c0a14bb34921fefaa5ea43bd98e85d56524113fc55ee4b6d8"
    ],
    character: [
      "56efc5559823268cf3036ec3ecb4471463ca9f98ed64d7edef737789e901dcee",
      "9e64dd23d4478aece4241e0e354de40060253d1a9ecfc4cc1aec5d2a6b7acf77"
    ],
    style: [
      "ca7a557d8096065847f5b809a9adbf7972c12b47f805b29937463e65b8884e7f",
      "bdeef282d2289bfe2de0dc761f555d9b6ddf542e41e976d5a6a3df874a82bf23"
    ]
  },
  "long-book-analysis": {
    "plot-structure": [
      "d25264fa8a23979c6a110f9a9cdc9364f3e7ced11ba983287461a1cf5773c159",
      "52cec43582a57c599f6daa369d51b1b6861546a8298ff89f2e27ffea14e97213"
    ],
    character: [
      "95a8c5698b728c73dfa9ae98e1e6b104929c279631769678641ce5d1d11386ed",
      "46b7639dcf15123f588c81de6aec6f849f92fb90512a91118465c7e7f73db9ae"
    ],
    style: [
      "8d7a8ad99f66e50af336297c8c114cfd86b99fd5fb27531f4c45a0b8d6f28593",
      "4c452a4b41bcdf13961fb8c2d082a2f9111bcb4bee2c6d7fb950cd1ceac8dbfb"
    ]
  },
  "book-title-design": {
    default: [
      "4a7faf197260ba801299950bf4ed1fa8a062d7c181ce7a760276fc3a470ec315"
    ]
  },
  "book-synopsis-design": {
    default: [
      "2243d13e188e6ff01d8e030746af382f7c5893be2af16750e4e6bdd83b196c68"
    ]
  },
  "book-cover-design": {
    default: [
      "945ea801837824fbc0939efc83b2c5d57b3c2721179cb803343cf77ac668ce0a"
    ]
  }
};
