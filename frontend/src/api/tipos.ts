export interface Plan {
  id: number;
  nombre: string;
  descripcion: string | null;
  precio: string;
  duracion_dias: number;
  puntos_otorgados: number;
  costo_en_puntos: number | null;
  activo: boolean;
}

export interface Promocion {
  id: number;
  codigo: string;
  descripcion: string;
  tipo: 'PORCENTAJE' | 'MONTO_FIJO';
  valor: string;
  plan_id: number | null;
  plan_nombre: string | null;
  vigente_desde: string;
  vigente_hasta: string;
  usos_maximos: number | null;
  usos_actuales: number;
  activo: boolean;
  disponible: boolean;
}

export interface Socio {
  id: number;
  documento: string;
  nombres: string;
  apellidos: string;
  nombre_completo: string;
  correo: string | null;
  telefono: string | null;
  fecha_nacimiento: string | null;
  activo: boolean;
  baneado: boolean;
  motivo_baneo: string | null;
  baneado_hasta: string | null;
  plan_nombre: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  estado_membresia: 'VIGENTE' | 'VENCIDA' | 'SIN_MEMBRESIA';
  dias_plan: number;
  dias_transcurridos: number;
  dias_restantes: number;
  dias_asistidos: number;
  dias_faltados: number;
  puntos: number;
}

export interface MovimientoPuntos {
  id: number;
  puntos: number;
  origen: string;
  descripcion: string | null;
  creado_en: string;
}

export interface Membresia {
  id: number;
  fecha_inicio: string;
  fecha_fin: string;
  estado: string;
  precio_lista: string;
  descuento: string;
  precio_final: string;
  pagada_con_puntos: boolean;
  plan_nombre: string;
  promocion: string | null;
}

export interface Asistencia {
  id: number;
  socio_id?: number;
  documento?: string;
  socio?: string;
  fecha: string;
  hora_ingreso: string;
}

export interface SocioDetalle extends Socio {
  membresias: Membresia[];
  asistencias: Asistencia[];
  movimientos_puntos: MovimientoPuntos[];
}

export interface Producto {
  id: number;
  nombre: string;
  descripcion: string | null;
  costo_en_puntos: number;
  stock: number;
  activo: boolean;
}

export interface Staff {
  id: number;
  usuario: string;
  nombre_completo: string;
  correo: string | null;
  telefono: string | null;
  rol: 'ADMINISTRADOR' | 'OPERADOR';
  activo: boolean;
  ultimo_acceso: string | null;
}

export interface Tablero {
  socios_activos: number;
  socios_vigentes: number;
  socios_baneados: number;
  asistencias_hoy: number;
  membresias_por_vencer: number;
  ingresos_mes?: number;
  operaciones_mes?: number;
  asistencias_semana?: { fecha: string; total: number }[];
  planes_top?: { nombre: string; membresias: number }[];
}

export interface Listado<T> {
  datos: T[];
  paginacion?: { pagina: number; limite: number; total: number };
}
