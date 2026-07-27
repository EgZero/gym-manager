import type { ReactNode } from 'react';

export function Mensaje({
  tipo,
  texto,
}: {
  tipo: 'error' | 'exito' | 'info';
  texto: string | null;
}): JSX.Element | null {
  if (!texto) return null;
  return <div className={`mensaje ${tipo}`}>{texto}</div>;
}

export function Insignia({ estado }: { estado: string }): JSX.Element {
  const clase = estado.toLowerCase().replace(/\s+/g, '_');
  return <span className={`insignia ${clase}`}>{estado.replace(/_/g, ' ')}</span>;
}

export function Modal({
  titulo,
  children,
  alCerrar,
  alGuardar,
  textoGuardar = 'Guardar',
  guardando = false,
}: {
  titulo: string;
  children: ReactNode;
  alCerrar: () => void;
  alGuardar?: () => void;
  textoGuardar?: string;
  guardando?: boolean;
}): JSX.Element {
  return (
    <div className="modal-fondo" onClick={alCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{titulo}</h2>
        {children}
        <footer>
          <button className="secundario" onClick={alCerrar}>
            Cancelar
          </button>
          {alGuardar && (
            <button onClick={alGuardar} disabled={guardando}>
              {guardando ? 'Guardando…' : textoGuardar}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export function Campo({
  etiqueta,
  anchoTotal = false,
  children,
}: {
  etiqueta: string;
  anchoTotal?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={anchoTotal ? 'ancho-total' : undefined}>
      <label>{etiqueta}</label>
      {children}
    </div>
  );
}

export function Progreso({ actual, total }: { actual: number; total: number }): JSX.Element {
  const porcentaje = total > 0 ? Math.min(100, Math.round((actual / total) * 100)) : 0;
  return (
    <div title={`${actual} de ${total} días`}>
      <div className="barra-progreso">
        <div style={{ width: `${porcentaje}%` }} />
      </div>
      <small style={{ color: 'var(--texto-tenue)' }}>
        {actual}/{total} días
      </small>
    </div>
  );
}

export const dinero = (valor: number | string): string =>
  new Intl.NumberFormat('es-HN', { style: 'currency', currency: 'HNL' }).format(Number(valor));

export const fecha = (valor: string | null): string =>
  valor ? new Date(valor).toLocaleDateString('es-HN') : '—';

export const fechaHora = (valor: string | null): string =>
  valor ? new Date(valor).toLocaleString('es-HN') : '—';
