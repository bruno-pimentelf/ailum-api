import { env } from '../config/env.js'

export interface TextToSpeechParams {
  text: string
  voiceId: string
  provider: 'ELEVENLABS' | 'AZURE' | 'OPENAI'
}

export class VoiceService {
  async textToSpeech(params: TextToSpeechParams): Promise<Buffer> {
    switch (params.provider) {
      case 'ELEVENLABS':
        return this.elevenLabsTTS(params.text, params.voiceId)
      case 'OPENAI':
        return this.openaiTTS(params.text, params.voiceId)
      case 'AZURE':
        throw new Error('Azure TTS: not implemented')
    }
  }

  private async elevenLabsTTS(text: string, voiceId: string): Promise<Buffer> {
    const response = await globalThis.fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': env.ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    )

    if (!response.ok) {
      throw new Error(`ElevenLabs TTS error ${response.status}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }

  private async openaiTTS(text: string, voiceId: string): Promise<Buffer> {
    // TODO: implement OpenAI TTS via @anthropic-ai/sdk or openai SDK
    throw new Error('OpenAI TTS: not implemented')
  }
}
