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

بطاقة تعريف الدفتر (قواعد ثابتة وملزمة):
1. كل يوم له ورقتان متقابلتان: اليمين = المبيعات (sell)، واليسار = المشتريات (buy). التاريخ والسعر اليومي في رأس الورقة الأولى. اليوم قد يمتد على أكثر من ورقة؛ أوراق التكملة تاريخها فارغ (continuation).
   - للتحقق المزدوج (H-A): اقرأ العنوان المطبوع أعلى الورقة (printed_header_side: "sell" أو "buy" أو "both") وحدد في has_balance_column هل الورقة تحتوي على صف/أعمدة "الرصيد/الرصيد السابق" (وهي علامة ورقة المبيعات).
2. كل ورقة فيها كتلتان من الأعمدة جنب بعض (H-C):
   - الكتلة 1 = الكتلة اليمنى (block_index = 1)، والكتلة 2 = الكتلة اليسرى (block_index = 2).
   - ترتيب القراءة والتسجيل الزمني: اقرأ الكتلة اليمنى (1) كلها من أعلى لأسفل، ثم الكتلة اليسرى (2) كلها من أعلى لأسفل.
   - لكل صف أرجع block_index (1 أو 2) و line_in_block (رقم السطر المسطّر داخل الكتلة يبدأ من 1 شاملاً السطور الفارغة إن وُجدت).
3. أعمدة كل كتلة: البيان (item)، الوزن مقسوم إلى خانتين (جرام weight_g، وملي weight_ml)، والإجمالي (total). وفي ورقة المبيعات أيضاً: الرصيد السابق/إجمالي الرصيد (running_balance_before, running_balance_after, book_running_cash).
   - ورقة المبيعات (اليمين) فيها رصيد الخزنة أعلى الورقة (book_opening_cash) والرصيد الختامي أسفل آخر ورقة مبيعات (book_closing_cash).
   - أي سطر في ورقة المبيعات يبدو حركة نقدية وليس بيع ذهب (مثل "كاش"، "مصروف"، "سلفة"، "دفعة") ضعه أيضاً في cash_movement_suspects.
4. الأرقام الحمراء (غالباً داخل دوائر بجانب الصف) = عدد القطع المباعة من الريون (pieces)، وليست مبالغ ولا أوزاناً ولا علامات مراجعة!
   - ضع العدد الأحمر المرتبط بالصف في حقل pieces (عدد صحيح مثل 1 أو 2 أو 3) ومعه pieces_confidence، ولا تعتبره مبلغاً أو وزناً أو صفاً جديداً أبداً.
   - الأرقام الحمراء المنفصلة التي لا ترتبط بصف معين ضعها في red_other.
   - الكتابات الحمراء في المساحة الفاضية آخر اليوم (جمع/طرح/رصيد مكتوب باليد خارج الجدول) ضعها في free_area_notes.
5. مصادر البيع (H7 & H-B): الريون (المعروض)، الكيس/العلب (تُحدَّد بكلمة "كيس/علبة/علب" في البيان)، الذهب القديم (تُحدَّد بالكلمات: "قديم / من القديم / من الكسر / كسر اليوم"). إن ظهرت كلمة تدل على المصدر ضعها في source_hint. وإن وُجدت أوزان مكتوبة للكيس أو القديم خارج الصفوف ضعها في bucket_weights.
6. تمييز الأرقام الهندية المكتوبة بخط اليد بدقة:
   - الصفر الهندي (٠) نقطة صغيرة، بينما الخمسة الهندية (٥) حلقة مستديرة أو بيضاوية أكبر.
   - الاثنان (٢) فتحتها لليمين فوق السطر، بينما الثلاثة (٣) لها سنّتان أو ثلاث أسنان في الأعلى.
   - الأربعة (٤) لا تخلطها مع ٢ أو ٣. الستة (٦) والسبعة (٧) والثمانية (٨) والتسعة (٩) ميّز اتجاه رؤوسها بدقة.
7. لا تخمّن أبداً رقماً غير واضح أو مطموس؛ اكتب القيمة الأقرب لما تراه وضع confidence منخفضة (أقل من 0.65).
8. الإجماليات المكتوبة بخط اليد أسفل كل جانب ضعها في مصفوفة totals لكل جانب وفي totals_row، ولا تعتبرها عملية داخل rows.`;

const LEDGER_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    kind: {
      type: Type.STRING,
      description: 'تصنيف الورقة: day_start أو continuation أو blank أو cover أو unreadable',
    },
    date: {
      type: Type.STRING,
      nullable: true,
      description: 'تاريخ الصفحة بصيغة YYYY-MM-DD إن وجد أو null (في أوراق التكملة يكون null)',
    },
    weekday: {
      type: Type.STRING,
      nullable: true,
      description: 'اسم يوم الأسبوع المكتوب في الترويسة مثل السبت أو الأحد أو null',
    },
    day_gold_price: {
      type: Type.NUMBER,
      nullable: true,
      description: 'سعر الذهب اليومي للجرام المكتوب أعلى الصفحة إن وجد أو null',
    },
    opening_balance: {
      type: Type.NUMBER,
      nullable: true,
      description: 'الرصيد السابق / الافتتاحي المكتوب أعلى الورقة إن وجد أو null',
    },
    closing_balance: {
      type: Type.NUMBER,
      nullable: true,
      description: 'الرصيد الختامي المكتوب أسفل الورقة إن وجد أو null',
    },
    book_opening_cash: {
      type: Type.NUMBER,
      nullable: true,
      description: 'رصيد الخزنة السابق المكتوب أعلى ورقة المبيعات (اليمين) إن وجد أو null',
    },
    book_closing_cash: {
      type: Type.NUMBER,
      nullable: true,
      description: 'رصيد الخزنة الختامي المكتوب أسفل آخر ورقة مبيعات في اليوم إن وجد أو null',
    },
    side: {
      type: Type.STRING,
      nullable: true,
      description: 'الجانب الظاهر في الورقة: buy أو sell أو both',
    },
    printed_header_side: {
      type: Type.STRING,
      nullable: true,
      description: 'العنوان المطبوع المرصود أعلى الورقة: sell (المبيعات) أو buy (المشتريات) أو both أو null',
    },
    has_balance_column: {
      type: Type.BOOLEAN,
      nullable: true,
      description: 'هل تحتوي الورقة على صف/عمود الرصيد السابق (علامة ورقة المبيعات)؟',
    },
    page_number_hint: {
      type: Type.STRING,
      nullable: true,
      description: 'رقم الصفحة المطبوع أو المكتوب إن وجد أو null',
    },
    page_confidence: {
      type: Type.NUMBER,
      nullable: true,
      description: 'متوسط درجة الثقة في قراءة الورقة من 0 إلى 1',
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
          block_index: {
            type: Type.NUMBER,
            nullable: true,
            description: 'رقم الكتلة في الورقة: 1 للكتلة اليمنى، 2 للكتلة اليسرى',
          },
          line_in_block: {
            type: Type.NUMBER,
            nullable: true,
            description: 'رقم السطر المسطّر داخل الكتلة يبدأ من 1 من أعلى الكتلة',
          },
          line_no: {
            type: Type.NUMBER,
            nullable: true,
            description: 'رقم السطر في الورقة يبدأ من 1',
          },
          pieces: {
            type: Type.NUMBER,
            nullable: true,
            description: 'العدد الأحمر (داخل دائرة) المرتبط بهذا الصف ويمثل عدد القطع المباعة من الريون أو null',
          },
          pieces_confidence: {
            type: Type.NUMBER,
            nullable: true,
            description: 'درجة الثقة في قراءة عدد القطع الأحمر من 0 إلى 1',
          },
          source_hint: {
            type: Type.STRING,
            nullable: true,
            description: 'الكلمة التي دلت على مصدر البيع إن وجدت في البيان مثل كيس أو علبة أو قديم أو من الكسر',
          },
          running_balance_before: {
            type: Type.NUMBER,
            nullable: true,
            description: 'الرصيد قبل العملية إن وجد في عمود الرصيد المتتابع أو null',
          },
          running_balance_after: {
            type: Type.NUMBER,
            nullable: true,
            description: 'الرصيد بعد العملية إن وجد في عمود الرصيد المتتابع أو null',
          },
          book_running_cash: {
            type: Type.NUMBER,
            nullable: true,
            description: 'رصيد الخزنة الظاهر بعد الصف في ورقة المبيعات إن وجد أو null',
          },
          y_ratio: {
            type: Type.NUMBER,
            nullable: true,
            description: 'الموضع الرأسي التقريبي للصف في الصفحة من 0.0 (أعلى) إلى 1.0 (أسفل)',
          },
          y_top: {
            type: Type.NUMBER,
            nullable: true,
            description: 'أعلى السطر كنسبة من ارتفاع الورقة (0..1)',
          },
          y_bottom: {
            type: Type.NUMBER,
            nullable: true,
            description: 'أسفل السطر كنسبة من ارتفاع الورقة (0..1)',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'درجة الثقة في قراءة الصف من 0 إلى 1',
          },
        },
        required: ['type', 'item', 'weight_g', 'weight_ml', 'total', 'confidence'],
      },
    },
    totals: {
      type: Type.ARRAY,
      nullable: true,
      description: 'الإجماليات المكتوبة بخط اليد أسفل كل جانب (sell و buy)',
      items: {
        type: Type.OBJECT,
        properties: {
          side: {
            type: Type.STRING,
            description: 'sell أو buy',
          },
          handwritten_total_amount: {
            type: Type.NUMBER,
            nullable: true,
            description: 'إجمالي المبلغ المكتوب بخط اليد أسفل الجدول',
          },
          handwritten_total_weight_g: {
            type: Type.NUMBER,
            nullable: true,
            description: 'إجمالي الوزن بالجرام المكتوب بخط اليد أسفل الجدول',
          },
          closing_balance: {
            type: Type.NUMBER,
            nullable: true,
            description: 'الرصيد الختامي لهذا الجانب إن وجد',
          },
          candidates: {
            type: Type.ARRAY,
            nullable: true,
            items: { type: Type.NUMBER },
            description: 'كل القيم المقروءة للإجمالي إن كان مشطوباً ومكتوباً بجانبه تصحيح',
          },
          location_hint: {
            type: Type.STRING,
            nullable: true,
            description: 'وصف مكان الإجمالي مثل أسفل يمين الصفحة',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'درجة الثقة في قراءة الإجمالي من 0 إلى 1',
          },
        },
        required: ['side', 'handwritten_total_amount', 'handwritten_total_weight_g', 'confidence'],
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
      description: 'علامات الحبر الأحمر (أعداد القطع داخل دوائر، صح، شطب، ملاحظات)',
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            description: 'نوع العلامة الحمراء: circle أو tick أو underline أو strike أو number أو text أو other',
          },
          row_hint: {
            type: Type.NUMBER,
            nullable: true,
            description: 'رقم أقرب صف (يبدأ من 1) ترتبط به العلامة الحمراء أو null إن كانت عامة',
          },
          text: {
            type: Type.STRING,
            description: 'النص أو الرقم المكتوب بالحبر الأحمر أو وصف العلامة',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'درجة الثقة من 0 إلى 1',
          },
        },
        required: ['type', 'text', 'confidence'],
      },
    },
    red_other: {
      type: Type.ARRAY,
      nullable: true,
      description: 'الأرقام أو الكتابات الحمراء التي لا ترتبط بصف معين (إجمالي، تصحيح، ملاحظة)',
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          numeric_value: { type: Type.NUMBER, nullable: true },
          category: { type: Type.STRING, nullable: true },
          location_hint: { type: Type.STRING, nullable: true },
          confidence: { type: Type.NUMBER },
        },
        required: ['text', 'confidence'],
      },
    },
    free_area_notes: {
      type: Type.ARRAY,
      nullable: true,
      description: 'الحسابات والكتابات المكتوبة باليد (غالباً أحمر داخل دوائر) في المساحة الفاضية آخر اليوم خارج صفوف الجدول',
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          numeric_value: { type: Type.NUMBER, nullable: true },
          suggested_category: {
            type: Type.STRING,
            nullable: true,
            description: 'sum أو subtract أو balance أو note',
          },
          location_hint: { type: Type.STRING, nullable: true },
          confidence: { type: Type.NUMBER },
        },
        required: ['text', 'confidence'],
      },
    },
    cash_movement_suspects: {
      type: Type.ARRAY,
      nullable: true,
      description: 'أي سطر في ورقة المبيعات يبدو حركة نقدية (كاش / مصروف / سلفة / دفعة شخص) وليس بيع ذهب',
      items: {
        type: Type.OBJECT,
        properties: {
          text: { type: Type.STRING },
          amount: { type: Type.NUMBER },
          block_index: { type: Type.NUMBER, nullable: true },
          line_in_block: { type: Type.NUMBER, nullable: true },
          confidence: { type: Type.NUMBER },
        },
        required: ['text', 'amount', 'confidence'],
      },
    },
    bucket_weights: {
      type: Type.OBJECT,
      nullable: true,
      description: 'أوزان الكيس/العلب أو الذهب القديم المكتوبة خارج صفوف العمليات إن وجدت (قبل/حالي)',
      properties: {
        bag_before_g: { type: Type.NUMBER, nullable: true },
        bag_actual_g: { type: Type.NUMBER, nullable: true },
        old_gold_before_g: { type: Type.NUMBER, nullable: true },
        old_gold_actual_g: { type: Type.NUMBER, nullable: true },
        rayon_pieces_before: { type: Type.NUMBER, nullable: true },
        rayon_pieces_actual: { type: Type.NUMBER, nullable: true },
      },
    },
  },
  required: ['kind', 'date', 'day_gold_price', 'rows', 'totals_row', 'red_marks'],
};

const ORIENTATION_REGIONS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    orientationDeg: {
      type: Type.NUMBER,
      description: 'زاوية التدوير اللازمة لتصبح الصفحة معتدلة للقراءة: 0 أو 90 أو 180 أو 270',
    },
    confidence: {
      type: Type.NUMBER,
      description: 'درجة الثقة في اكتشاف الاتجاه من 0 إلى 1',
    },
    isSidewaysTwoSheets: {
      type: Type.BOOLEAN,
      description: 'هل الصورة تحوي ورقتين منفصلتين مصورتين معاً (فوق بعض أو بجانب بعض)؟',
    },
    regions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          side: {
            type: Type.STRING,
            description: 'نوع الورقة أو القسم: sell أو buy أو both',
          },
          label: {
            type: Type.STRING,
            description: 'وصف المنطقة مثل نصف المبيعات الأيمن أو الورقة العلوية',
          },
          x: { type: Type.NUMBER, description: 'إحداثي X النسبي من 0 إلى 1' },
          y: { type: Type.NUMBER, description: 'إحداثي Y النسبي من 0 إلى 1' },
          w: { type: Type.NUMBER, description: 'العرض النسبي من 0 إلى 1' },
          h: { type: Type.NUMBER, description: 'الارتفاع النسبي من 0 إلى 1' },
        },
        required: ['side', 'label', 'x', 'y', 'w', 'h'],
      },
    },
  },
  required: ['orientationDeg', 'confidence', 'isSidewaysTwoSheets', 'regions'],
};

const WEAK_CELLS_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verifications: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          cellId: { type: Type.STRING },
          verifiedValue: { type: Type.STRING },
          confidence: { type: Type.NUMBER },
        },
        required: ['cellId', 'verifiedValue', 'confidence'],
      },
    },
  },
  required: ['verifications'],
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

function createGenAiClient(apiKey: string) {
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
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
      const ai = createGenAiClient(apiKey);
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
    dictionaryHints?: string;
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
        const ai = createGenAiClient(apiKey);
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
            ? 'ملاحظة: هذه هي الشريحة السفلية (النصف الثاني) من الصفحة. اقرأ كل صف عملية واضح فيها، وضع صف الإجمالي السفلي في totals و totals_row فقط.'
            : '';

        const dictText = params.dictionaryHints
          ? `\nتعليمات إضافية من قاموس تصحيحات المراجع المحلي (التزم بها عند قراءة الأصناف والأرقام المتشابهة):\n${params.dictionaryHints}`
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
                  text: `اقرأ صفحة دفتر الذهب المرفقة بدقة وأرجع النتيجة بصيغة JSON مطابقة للمخطط المطلوب (شاملاً التصنيف kind، التاريخ، الرصيد المتتابع إن وجد، الإجماليات المكتوبة بخط اليد totals، وعلامات الحبر الأحمر red_marks). ${sideHint} ${sliceHint}${dictText}`,
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
        const parsed = JSON.parse(text);
        // Ensure backward-compatible totals_row if model only filled totals[]
        if (!parsed.totals_row && Array.isArray(parsed.totals) && parsed.totals.length > 0) {
          const firstTot = parsed.totals[0];
          parsed.totals_row = {
            weight_g: firstTot.handwritten_total_weight_g ?? null,
            total: firstTot.handwritten_total_amount ?? null,
          };
        }
        return parsed;
      });

      return { ok: true, data };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'حدث خطأ أثناء قراءة صورة الدفتر.' };
    }
  }

  /**
   * H2: Lightweight orientation (0/90/180/270) and multi-sheet region detection
   */
  public async detectPageOrientationAndRegions(params: {
    imageBase64: string;
    mimeType?: string;
    modelName?: string;
  }): Promise<{
    ok: boolean;
    data?: {
      orientationDeg: 0 | 90 | 180 | 270;
      confidence: number;
      isSidewaysTwoSheets: boolean;
      regions: Array<{
        side: 'buy' | 'sell' | 'both';
        label: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }>;
    };
    error?: string;
  }> {
    const apiKey = this.getStoredApiKey();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return { ok: false, error: 'مفتاح Gemini غير مسجل.' };
    }
    if (!params.imageBase64) {
      return { ok: false, error: 'بيانات الصورة مطلوبة.' };
    }
    const modelToUse = params.modelName?.trim() || DEFAULT_GEMINI_MODEL;

    try {
      const data = await withRetryAndConcurrency(async () => {
        const ai = createGenAiClient(apiKey);
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
                  text: `افحص اتجاه صورة صفحة دفتر الذهب هذه بالاعتماد على العناوين المطبوعة ("بسم الله الرحمن الرحيم"، "المشتريات"، "المبيعات"، "يومية يوم").
1) حدد زاوية التدوير اللازمة مع عقارب الساعة (0 أو 90 أو 180 أو 270) لتصبح الصفحة معتدلة القراءة.
2) حدد ما إذا كانت الصورة تحوي ورقتين متقابلتين (يمين مبيعات sell / يسار مشتريات buy) أو ورقتين فوق بعض، وأرجع المستطيلات النسبية (x, y, w, h من 0 إلى 1 بعد التدوير) لكل قسم.`,
                },
              ],
            },
          ],
          config: {
            responseMimeType: 'application/json',
            responseSchema: ORIENTATION_REGIONS_SCHEMA,
            temperature: 0.05,
          },
        });
        const parsed = JSON.parse(response.text || '{}');
        const rawDeg = Number(parsed.orientationDeg) || 0;
        const normalizedDeg = ([0, 90, 180, 270].includes(rawDeg) ? rawDeg : 0) as 0 | 90 | 180 | 270;
        return {
          orientationDeg: normalizedDeg,
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.85,
          isSidewaysTwoSheets: Boolean(parsed.isSidewaysTwoSheets),
          regions: Array.isArray(parsed.regions) ? parsed.regions : [],
        };
      });

      return { ok: true, data };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر فحص اتجاه الصفحة.' };
    }
  }

  /**
   * P4: Batched second-pass verification of weak cells (confidence < 0.7) in a single API call
   */
  public async verifyWeakCells(params: {
    cells: Array<{
      cellId: string;
      field: 'weight' | 'total' | 'item';
      firstReadValue: string | number;
      imageBase64: string;
    }>;
    modelName?: string;
  }): Promise<{
    ok: boolean;
    verifications?: Array<{ cellId: string; verifiedValue: string; confidence: number }>;
    error?: string;
  }> {
    const apiKey = this.getStoredApiKey();
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      return { ok: false, error: 'مفتاح Gemini غير مسجل.' };
    }
    const cells = Array.isArray(params.cells) ? params.cells.slice(0, 20) : [];
    if (cells.length === 0) {
      return { ok: true, verifications: [] };
    }

    const modelToUse = params.modelName?.trim() || DEFAULT_GEMINI_MODEL;

    try {
      const verifications = await withRetryAndConcurrency(async () => {
        const ai = createGenAiClient(apiKey);
        const parts: any[] = [];
        for (const c of cells) {
          parts.push({
            inlineData: {
              data: c.imageBase64,
              mimeType: 'image/jpeg',
            },
          });
          parts.push({
            text: `خلية رقم [${c.cellId}] (نوع الحقل: ${
              c.field === 'weight' ? 'وزن بالجرام والملي' : c.field === 'total' ? 'مبلغ بالجنيه' : 'اسم صنف'
            }، القراءة الأولى المشكوك فيها: "${c.firstReadValue}")`,
          });
        }
        parts.push({
          text: 'ركّز بدقة شديدة في الأرقام الهندية المكتوبة بخط اليد في كل خلية مقصوصة أعلاه، وأرجع القيمة الصحيحة لكل cellId مع درجة الثقة.',
        });

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: [{ role: 'user', parts }],
          config: {
            systemInstruction: LEDGER_SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: WEAK_CELLS_RESPONSE_SCHEMA,
            temperature: 0.05,
          },
        });
        const parsed = JSON.parse(response.text || '{}');
        return Array.isArray(parsed.verifications) ? parsed.verifications : [];
      });

      return { ok: true, verifications };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'تعذر إعادة التحقق من الخلايا الضعيفة.' };
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
        const ai = createGenAiClient(apiKey);
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
