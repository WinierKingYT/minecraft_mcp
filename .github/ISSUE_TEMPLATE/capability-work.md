---
name: Capability work
about: Bir capability'yi uygulayan iş kalemi
title: "<ISSUE-ID> — <Başlık>"
labels: []
---

## Kullanıcı değeri

Bu iş hangi JTBD veya requirement'ı karşılıyor?

## Milestone

D0 / M0 / M1 / M2A / M2B / M3 / V1

## Capability

`<capability-id>` — kayıt: `packages/capability-registry/capabilities/<id>.yaml`

## Risk metadata

- effect:
- scope:
- reversibility:
- approval:
- exposure:
- derived_level:

> `derived_level` elle yazılmaz; `scripts/validate-registry.mjs` metadata'dan
> türetip kaydınızdaki değerle karşılaştırır.

## Ön koşullar

- ...

## Girdi sözleşmesi

- schema:
- örnek:

## Başarı sonucu

- ...

## Hata durumları

- `ERROR_CODE`
- `ERROR_CODE`

> Her kod `packages/error-catalog/errors/<owner>.yaml` içinde tanımlı olmalı ve
> `suggested_action` taşımalıdır (KPI-08).

## State geçişleri

- önce:
- sonra:
- timeout:
- cancellation:
- unknown outcome:

## Güvenlik

- trust requirement:
- path impact:
- process impact:
- network impact:
- secrets:
- cleanup:

## Kabul testleri

- unit:
- contract:
- integration:
- security:
- e2e:

## Kanıt

- evidence kind:
- report field:
- audit event:

## Definition of Done

- [ ] Kod
- [ ] Schema
- [ ] Generated types (`pnpm run gen`)
- [ ] Error catalog
- [ ] Tests
- [ ] Negative tests
- [ ] Evidence
- [ ] Documentation
- [ ] `docs/traceability.md` satırı eklendi
- [ ] CI green
