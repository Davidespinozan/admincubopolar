// UsuariosView — módulo "Usuarios" del área Sistema (2026-10-09; antes dentro
// de Ajustes y del Panel del dueño). Altas, roles, accesos adicionales y
// contraseñas: el servidor decide qué puede cada quien (guardar_usuario).
import UsuariosPanel from '../UsuariosPanel';

export function UsuariosView({ data, actions, user }) {
  return <UsuariosPanel data={data} actions={actions} user={user} />;
}
