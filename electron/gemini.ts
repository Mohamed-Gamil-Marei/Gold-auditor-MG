import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';

export interface GeminiKeyManagerOptions {
  dataDir: string;
  safeStorage?: {
    isEncryptionAvailable: () => boolean;
    encryptString: (plainText: string) => Buffer;
    decryptString: (encrypted: Buffer) => string;
  };
}

const LEDGER_SYSTEM_INSTRUCTION = `أنت خبير محاسبة ومراجع دفاتر محلات ذهب مصرية وعربية.
مهمتك قراءة صورة صفحة من دفتر يومية محل ذهب مكتوبة بخط اليد باللغة العربية وبأرقام عربية هندية (٠١٢٣٤٥٦٧٨٩) أو إنجليزية.

قواعد حاسمة وملزمة:
1. الصفحة من دفتر يومية محل ذهب بخط يدوي عربي وأرقام هندية؛ الجانب الأيمن عادة "مبيعات" (sell) والجانب الأيسر "مشتريات" (buy) — تحقق من العنوان المطبوع أو المكتوب أعلى كل نصف.
2. الأعمدة في كل نصف هي: البيان (اسم الصنف مثل خاتم، غويشة، سلسلة، حلق، دبلة، سبيكة، جنيه، كسر...)، الوزن مقسوم إلى خانتين (جرام، ملي/مليجرام)، والإجمالي (المبلغ بالجنيه).
3. أمثلة هامة جداً لتمييز الأرقام الهندية المكتوبة بخط اليد حتى لا يختلط عليك الأمر:
   - الصفر الهندي (٠) نقطة صغيرة، بينما الخمسة الهندية (٥) حلقة مستديرة أو بيضاوية أكبر.
   - الاثنان (٢) فتحتها لليمين فوق السطر، بينما الثلاثة (٣) لها سنّتان أو ثلاث أسنان في الأعلى (وأحياناً تُكتب بشرطة متموجة).
   - الأربعة (٤) تشبه ع معكوسة أو 3 معكوسة، لا تخلطها مع ٢ أو ٣.
   - الستة (٦) رأسها لليسار في الأعلى وعصاها نازلة لليمين، بينما السبعة (٧) على شكل حرف V للأعلى، والثمانية (٨) على شكل Λ للأسفل.
   - التسعة (٩) رأسها مغلق في الأعلى وعصاها نازلة، لا تخلطها مع ٦ أو ٥.
4. الرقم المكتوب منفرداً أعلى خانة البيان في أول صفحة المبيعات (أو في ترويسة الصفحة) غالباً هو "سعر الذهب اليومي للجرام" (day_gold_price) مثل 3800 أو 7450.
5. تجاهل تماماً أي كتابة أو خطوط أو علامات صح أو أرصدة أو إجماليات مكتوبة بالحبر الأحمر لأنها علامات مراجعة لاحقة وليست عمليات يومية؛ سجّل نصوصها فقط في مصفوفة red_marks ولا تضعها أبداً ضمن rows.
6. لا تخمّن أبداً رقماً غير واضح أو مطموس؛ اكتب القيمة الأقرب لما تراه وضع confidence منخفضة (أقل من 0.65).
7. لا تضف صفوفاً غير موجودة في الصورة إطلاقاً، وتجاهل الأسطر الفارغة.
8. الصف الإجمالي في أسفل الصفحة أو أسفل الجدول ضعه في totals_row فقط ولا تعتبره عملية داخل rows.`;

const LEDGER_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    date: {
      type: Type.STRING,
      nullable: true,
      description: 'تاريخ الصفحة بصيغة YYYY-MM-DD إن وجد أو null',
    },
    day_gold_price: {
      type: Type.NUMBER,
      nullable: true,
      description: 'سعر الذهب اليومي للجرام المكتوب أعلى الصفحة إن وجد أو null',
    },
    rows: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            description: 'buy للمشتريات أو sell للمبيعات',
          },
          item: {
            type: Type.STRING,
            description: 'البيان أو الصنف أو نص فارغ',
          },
          weight_g: {
            type: Type.NUMBER,
            description: 'الوزن الصحيح بالجرام (بدون الملي)',
          },
          weight_ml: {
            type: Type.NUMBER,
            description: 'الوزن بالملي (من 0 إلى 999)',
          },
          total: {
            type: Type.NUMBER,
            description: 'إجمالي المبلغ',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'درجة الثقة في قراءة الصف من 0 إلى 1',
          },
        },
        required: ['type', 'item', 'weight_g', 'weight_ml', 'total', 'confidence'],
      },
    },
    totals_row: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        weight_g: { type: Type.NUMBER, nullable: true },
        total: { type: Type.NUMBER, nullable: true },
      },
    },
    red_marks: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'أي كتابات أو أرقام أو ملاحظات مكتوبة بالحبر الأحمر',
    },
  },
  required: ['date', 'day_gold_price', 'rows', 'totals_row', 'red_marks'],
};

const MAX_CONCURRENT_REQUESTS = 2;
const MAX_IMAGE_BASE64_LENGTH = 14_000_000; // ~10MB binary image
let activeRequests = 0;

function translateGeminiError(err: any): string {
  const msg = String(err?.message || err || '');
  const lower = msg.toLowerCase();
  if (
    lower.includes('fetch failed') ||
    lower.includes('network') ||
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout')
  ) {
    return 'لا يوجد اتصال بالإنترنت. تأكد من اتصالك بالشبكة ثم أعد المحاولة.';
  }
  if (lower.includes('api_key_invalid') || lower.includes('401') || lower.includes('403') || lower.includes('invalid api key')) {
    return 'مفتاح Gemini غير صالح. يرجى التأكد من صحة المفتاح في شاشة الإعدادات.';
  }
  if (lower.includes('429') || lower.includes('quota') || lower.includes('rate limit') || lower.includes('resource_exhausted')) {
    return 'تم تجاوز حصة الاستخدام المسموحة (Quota) لمفتاح Gemini. انتظر قليلاً ثم أعد المحاولة.';
  }
  if (lower.includes('404') || lower.includes('not found') || lower.includes('model')) {
    return 'الموديل المحدد غير متاح حالياً. يمكنك تغيير اسم الموديل من الإعدادات.';
  }
  return msg || 'حدث خطأ غير متوقع أثناء الاتصال بخدمة Gemini.';
}

async function withRetryAndConcurrency<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    throw new Error('يوجد طلبان قيد التنفيذ حالياً. انتظر ثواني حتى يكتمل الطلب الحالي.');
  }
  activeRequests++;
  try {
    let lastError: any;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || '').toLowerCase();
        // Don't retry on invalid key
        if (msg.includes('api_key_invalid') || msg.includes('401') || msg.includes('invalid api key')) {
          break;
        }
        if (attempt < maxRetries) {
          const delayMs = attempt === 0 ? 1000 : 2500;
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    throw new Error(translateGeminiError(lastError));
  } finally {
    activeRequests = Math.max(0, activeRequests - 1);
  }
}

export class GeminiService {
  private keyFilePath: string;
  private safeStorage?: GeminiKeyManagerOptions['safeStorage'];

  constructor(options: GeminiKeyManagerOptions) {
    this.keyFilePath = path.join(options.dataDir, 'gemini_key.enc');
    this.safeStorage = options.safeStorage;
  }

  public isEncryptionAvailable(): boolean {
    if (this.safeStorage) {
      try {
        return this.safeStorage.isEncryptionAvailable();
      } catch {
        return false;
      }
    }
    return false;
  }

  public setApiKey(rawKey: string): { ok: boolean; warning?: string; error?: string } {
    try {
      const trimmed = rawKey.trim();
      if (!trimmed) {
        if (fs.existsSync(this.keyFilePath)) {
          fs.unlinkSync(this.keyFilePath);
        }
        return { ok: true };
      }

      fs.mkdirSync(path.dirname(this.keyFilePath), { recursive: true });
      if (this.safeStorage) {
        if (!this.safeStorage.isEncryptionAvailable()) {
          return {
            ok: false,
            error: 'تشفير نظام التشغيل (safeStorage) غير متاح على هذا الجهاز، لذلك لم يتم حفظ المفتاح حمايةً له.',
          };
        }
        const encrypted = this.safeStorage.encryptString(trimmed);
        fs.writeFileSync(this.keyFilePath, JSON.stringify({ mode: 'safeStorage', data: encrypted.toString('base64') }), 'utf-8');
        return { ok: true };
      } else {
        // Fallback obfuscation only in local dev server (non-Electron) where safeStorage is not passed
        const encoded = Buffer.from(trimmed, 'utf-8').toString('base64');
        fs.writeFileSync(this.keyFilePath, JSON.stringify({ mode: 'base64', data: encoded }), 'utf-8');
        return {
          ok: true,
          warning: 'تنبيه: تشفير نظام التشغيل (safeStorage) غير متاح في بيئة الخادم المحلي؛ تم حفظ المفتاح محلياً في مجلد بيانات المستخدم.',
        };
      }
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر حفظ مفتاح Gemini' };
    }
  }

  public getStoredApiKey(): string {
    try {
      if (fs.existsSync(this.keyFilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.keyFilePath, 'utf-8'));
        if (raw.mode === 'safeStorage' && this.safeStorage && this.safeStorage.isEncryptionAvailable()) {
          return this.safeStorage.decryptString(Buffer.from(raw.data, 'base64'));
        }
        if (raw.mode === 'base64' && raw.data) {
          return Buffer.from(raw.data, 'base64').toString('utf-8');
        }
      }
    } catch {
      // ignore read errors
    }
    return process.env.GEMINI_API_KEY || '';
  }

  public getStatus(): { hasKey: boolean; encryptionAvailable: boolean; usingEnvKey: boolean } {
    const fileExists = fs.existsSync(this.keyFilePath);
    const hasEnv = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
    const key = this.getStoredApiKey();
    return {
      hasKey: Boolean(key && key !== 'MY_GEMINI_API_KEY'),
      encryptionAvailable: this.isEncryptionAvailable(),
      usingEnvKey: !fileExists && hasEnv,
    };
  }

  public async testApiKey(customKey?: string, modelName = DEFAULT_GEMINI_MODEL): Promise<{ ok: boolean; message?: string; error?: string }> {
    const apiKey = (customKey && customKey.trim()) || this.getStoredApiKey();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return { ok: false, error: 'لم يتم إدخال مفتاح Gemini بعد. أدخل المفتاح أولاً.' };
    }
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: modelName || DEFAULT_GEMINI_MODEL,
        contents: 'أجب بكلمة واحدة فقط: متصل',
      });
      if (response && response.text) {
        return { ok: true, message: `تم الاتصال بنجاح (${modelName}) ✓` };
      }
      return { ok: true, message: 'المفتاح يعمل بنجاح ✓' };
    } catch (err: any) {
      return { ok: false, error: translateGeminiError(err) };
    }
  }

  public async readLedger(params: {
    imageBase64: string;
    mimeType?: string;
    forcedSideType?: 'buy' | 'sell' | 'auto';
    slicePosition?: 'full' | 'top' | 'bottom';
    modelName?: string;
  }): Promise<{ ok: boolean; data?: any; error?: string }> {
    const apiKey = this.getStoredApiKey();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return { ok: false, error: 'مفتاح Gemini غير مسجل. يرجى إدخال المفتاح في شاشة الإعدادات أولاً.' };
    }
    if (!params.imageBase64) {
      return { ok: false, error: 'بيانات الصورة مطلوبة.' };
    }
    if (params.imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      return { ok: false, error: 'حجم الصورة يتجاوز الحد الأقصى المسموح به (10 ميجابايت). يرجى تقليص الصورة.' };
    }

    const modelToUse = params.modelName?.trim() || DEFAULT_GEMINI_MODEL;

    try {
      const data = await withRetryAndConcurrency(async () => {
        const ai = new GoogleGenAI({ apiKey });
        const sideHint =
          params.forcedSideType === 'buy'
            ? 'هذه الصورة تمثل جانب المشتريات فقط (buy). اجعل جميع العمليات المقروءة من نوع buy.'
            : params.forcedSideType === 'sell'
            ? 'هذه الصورة تمثل جانب المبيعات فقط (sell). اجعل جميع العمليات المقروءة من نوع sell.'
            : 'حدد نوع كل عملية (buy للمشتريات في الجانب الأيسر، وsell للمبيعات في الجانب الأيمن) حسب موقعها وعنوان القسم.';

        const sliceHint =
          params.slicePosition === 'top'
            ? 'ملاحظة: هذه هي الشريحة العلوية (النصف الأول) من الصفحة. اقرأ كل صف واضح فيها بدقة، واستخرج التاريخ وسعر الذهب اليومي من الترويسة إن وجدا.'
            : params.slicePosition === 'bottom'
            ? 'ملاحظة: هذه هي الشريحة السفلية (النصف الثاني) من الصفحة. اقرأ كل صف عملية واضح فيها، وضع صف الإجمالي السفلي في totals_row فقط.'
            : '';

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    data: params.imageBase64,
                    mimeType: params.mimeType || 'image/jpeg',
                  },
                },
                {
                  text: `اقرأ صفحة دفتر الذهب المرفقة بدقة وأرجع النتيجة بصيغة JSON مطابقة للمخطط المطلوب. ${sideHint} ${sliceHint}`,
                },
              ],
            },
          ],
          config: {
            systemInstruction: LEDGER_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: LEDGER_RESPONSE_SCHEMA,
            temperature: 0.1,
          },
        });

        const text = response.text || '{}';
        return JSON.parse(text);
      });

      return { ok: true, data };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'حدث خطأ أثناء قراءة صورة الدفتر.' };
    }
  }

  public async summarizeAudit(params: {
    aggregatedStats: any;
    modelName?: string;
  }): Promise<{ ok: boolean; summary?: string; error?: string }> {
    const apiKey = this.getStoredApiKey();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return { ok: false, error: 'مفتاح Gemini غير مسجل. يرجى إدخال المفتاح في شاشة الإعدادات أولاً.' };
    }
    if (!params.aggregatedStats) {
      return { ok: false, error: 'البيانات الإحصائية المجمعة مطلوبة.' };
    }

    const modelToUse = params.modelName?.trim() || DEFAULT_GEMINI_MODEL;

    try {
      const summary = await withRetryAndConcurrency(async () => {
        const ai = new GoogleGenAI({ apiKey });
        const promptText = `أنت كبير مراجعي حسابات محلات ذهب في مصر. أمامك إحصائيات مجمعة فقط (بدون أي أسماء أشخاص أو صفوف خام) لنتيجة فحص ومراجعة محل ذهب:
${JSON.stringify(params.aggregatedStats, null, 2)}

المطلوب:
اكتب ملخصاً تنفيذياً من 5 أسطر باللهجة العربية المصرية المهنية البسيطة يوضح الوضع العام للمحل، ثم اقترح أول 3 أشياء مرتبة بالأهمية أبدأ بمراجعتها فوراً.`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: promptText,
          config: {
            temperature: 0.25,
          },
        });
        return response.text || 'لم يتم توليد ملخص.';
      });

      return { ok: true, summary };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'حدث خطأ أثناء توليد الملخص الذكي.' };
    }
  }
}
