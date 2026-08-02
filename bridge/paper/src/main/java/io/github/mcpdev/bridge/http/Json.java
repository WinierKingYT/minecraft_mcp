package io.github.mcpdev.bridge.http;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Minimal JSON yazıcı.
 *
 * <p>Bilinçli olarak bağımlılıksızdır. Bridge, hedef plugin ile aynı JVM'de
 * çalışır ve classpath'i paylaşır; bir JSON kütüphanesi eklemek hem
 * supply-chain yüzeyini büyütür hem de hedef plugin'in aynı kütüphaneyi farklı
 * sürümle getirmesi hâlinde çakışma üretir.
 *
 * <p>Yalnızca YAZMA desteklenir. Gelen gövdeler için ayrıştırma gerektiğinde
 * (POST /v1/query, /v1/action) şemaya bağlı ve sınırlı bir ayrıştırıcı ayrıca
 * eklenecektir; genel amaçlı bir JSON parser Bridge'e girmez.
 */
public final class Json {

    private static final char LINE_SEPARATOR = (char) 0x2028;
    private static final char PARAGRAPH_SEPARATOR = (char) 0x2029;

    private Json() {
    }

    public static String object(Map<String, ?> fields) {
        StringBuilder sb = new StringBuilder(128);
        sb.append('{');
        boolean first = true;
        for (Map.Entry<String, ?> entry : fields.entrySet()) {
            if (!first) {
                sb.append(',');
            }
            first = false;
            string(sb, entry.getKey());
            sb.append(':');
            value(sb, entry.getValue());
        }
        return sb.append('}').toString();
    }

    private static void value(StringBuilder sb, Object value) {
        switch (value) {
            case null -> sb.append("null");
            case String s -> string(sb, s);
            case Boolean b -> sb.append(b.booleanValue());
            case Integer i -> sb.append(i.intValue());
            case Long l -> sb.append(l.longValue());
            case Double d -> {
                if (d.isNaN() || d.isInfinite()) {
                    sb.append("null");
                } else {
                    sb.append(d.doubleValue());
                }
            }
            case Map<?, ?> m -> {
                @SuppressWarnings("unchecked")
                Map<String, ?> typed = (Map<String, ?>) m;
                sb.append(object(typed));
            }
            case List<?> list -> {
                sb.append('[');
                for (int i = 0; i < list.size(); i++) {
                    if (i > 0) {
                        sb.append(',');
                    }
                    value(sb, list.get(i));
                }
                sb.append(']');
            }
            default -> string(sb, String.valueOf(value));
        }
    }

    private static void string(StringBuilder sb, String raw) {
        sb.append('"');
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            switch (c) {
                case '"' -> sb.append("\\\"");
                case '\\' -> sb.append("\\\\");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                case '\b' -> sb.append("\\b");
                case '\f' -> sb.append("\\f");
                default -> {
                    // Kontrol karakterleri ve U+2028/U+2029 kaçırılır. Oyuncu
                    // adı gibi güvenilmez metinler bu yoldan geçer; bu iki
                    // ayırıcı JSON'da geçerli fakat JavaScript kaynağında
                    // satır sonu sayılır (ST-INJECT-001).
                    if (c < 0x20 || c == LINE_SEPARATOR || c == PARAGRAPH_SEPARATOR) {
                        sb.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        sb.append(c);
                    }
                }
            }
        }
        sb.append('"');
    }
}
