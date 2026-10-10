// CapturaFoto — una sola forma de adjuntar evidencia en toda la app: abrir la
// cámara o elegir una foto que ya está en el teléfono. Antes cada pantalla
// tenía su propio botón y solo abría la cámara (sin opción de galería).
// `onChange` recibe el evento del selector de archivo (lo procesa cada pantalla).
import { Icons } from './Icons';

const BOTON = 'flex min-h-[48px] cursor-pointer items-center justify-center gap-1.5 rounded-field px-3 text-[13px] font-semibold transition-transform active:scale-[0.98]';

export default function CapturaFoto({ etiqueta = 'Foto de evidencia', onChange, obligatoria = false, className = '' }) {
  return (
    <div data-testid="captura-foto" className={`rounded-field border-2 border-dashed p-2.5 ${obligatoria ? 'border-red-300 bg-red-50/50' : 'border-slate-300'} ${className}`}>
      <p className={`mb-2 flex items-center justify-center gap-1.5 text-[13px] font-semibold ${obligatoria ? 'text-red-600' : 'text-slate-500'}`}>
        <Icons.Camera /> {etiqueta}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className={`${BOTON} bg-ink text-white`}>
          Abrir cámara
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onChange} />
        </label>
        <label className={`${BOTON} border border-line bg-white text-ink`}>
          Elegir foto
          <input type="file" accept="image/*" className="hidden" onChange={onChange} />
        </label>
      </div>
    </div>
  );
}
