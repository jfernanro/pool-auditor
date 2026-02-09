# JDBC Pool Auditor

Herramienta web para auditar archivos `context.xml` de Tomcat y auditar/migrar configuraciones de pool JDBC al factory `EncryptedDataSourceFactoryPlus`.

## Caracteristicas

- Analisis de recursos DataSource en archivos XML
- Deteccion de configuraciones deficientes (maxActive, maxIdle, etc.)
- Migracion automatica a parametros Factory Plus
- Generacion de archivo `.NEW.xml` con correcciones
- Procesamiento 100% local (sin envio de datos)

## Uso local

```bash
npm install
npm run dev
```

## Deploy en GitHub Pages

1. Crea un repositorio en GitHub llamado `jdbc-pool-auditor`
2. Sube el contenido de este proyecto
3. En Settings > Pages, activa GitHub Pages con source "GitHub Actions"
4. El workflow se ejecutara automaticamente en cada push a `main`

## Reglas de auditoria

### Dimensionamiento
- `maxActive <= 1` = Error critico
- `maxActive < 10` = Warning (sugerido: 50 para PRO)
- `maxIdle = maxActive`
- `initialSize = max(1, floor(M * 0.1))`
- `minIdle = initialSize`

### Parametros obligatorios Factory Plus
- `factory = com.indra.jdbc.pool.EncryptedDataSourceFactoryPlus`
- `removeAbandoned = true`
- `removeAbandonedTimeout = 3600`
- `validationInterval = 30000`
- `testOnBorrow = true`
