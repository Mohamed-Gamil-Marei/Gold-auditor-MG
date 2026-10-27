// Legacy Express Server kept in legacy/ as requested in Prompt 1.6
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function startLegacyServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json({ limit: '12mb' }));

  const getAiClient = () =>
    new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

  app.post('/api/ocr-ledger', async (req, res) => {
    try {
      const { imageBase64, mimeType = 'image/jpeg' } = req.body;
      const ai = getAiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: {
          parts: [
            { inlineData: { mimeType, data: imageBase64 } },
            { text: 'اقرأ هذه الصفحة من دفتر يومية محل الذهب.' },
          ],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              rows: { type: Type.ARRAY, items: { type: Type.OBJECT } },
            },
          },
        },
      });
      res.json(JSON.parse(response.text || '{}'));
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
  app.listen(PORT, '127.0.0.1');
}
