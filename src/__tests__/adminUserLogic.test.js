// adminUserLogic.test.js — Tanda 20. Validación pura del flujo de alta
// de usuarios desde el panel admin. Reemplaza la Edge Function rota
// `hyper-endpoint` y blinda los roles válidos del ERP.

import { describe, it, expect } from 'vitest';
import {
  ROLES_VALIDOS,
  validateAdminCreateUser,
  mapAuthErrorToUserMessage,
} from '../data/adminUserLogic';

describe('ROLES_VALIDOS', () => {
  it('contiene los 7 roles canónicos del ERP con tildes y casing correcto', () => {
    expect(ROLES_VALIDOS).toEqual([
      'Admin',
      'Ventas',
      'Chofer',
      'Producción',
      'Almacén Bolsas',
      'Facturación',
      'Sin asignar',
    ]);
  });
});

describe('validateAdminCreateUser', () => {
  const valid = {
    nombre: 'Juan Pérez',
    email: 'JUAN@CuboPolar.com',
    password: 'pass1234',
    rol: 'Ventas',
  };

  it('input válido → ok con email lowercaseado y nombre trimeado', () => {
    const r = validateAdminCreateUser({ ...valid, nombre: '  Juan Pérez  ' });
    expect(r).toEqual({
      ok: true,
      nombre: 'Juan Pérez',
      email: 'juan@cubopolar.com',
      password: 'pass1234',
      rol: 'Ventas',
    });
  });

  it('input null/undefined → error "Nombre requerido"', () => {
    expect(validateAdminCreateUser(null).error).toBe('Nombre requerido');
    expect(validateAdminCreateUser(undefined).error).toBe('Nombre requerido');
    expect(validateAdminCreateUser({}).error).toBe('Nombre requerido');
  });

  it('nombre vacío o solo espacios → error', () => {
    expect(validateAdminCreateUser({ ...valid, nombre: '' }).error).toBe('Nombre requerido');
    expect(validateAdminCreateUser({ ...valid, nombre: '   ' }).error).toBe('Nombre requerido');
  });

  it('email faltante → error', () => {
    expect(validateAdminCreateUser({ ...valid, email: '' }).error).toBe('Email requerido');
  });

  it('email mal formado → error "Email inválido"', () => {
    expect(validateAdminCreateUser({ ...valid, email: 'no-arroba' }).error).toBe('Email inválido');
    expect(validateAdminCreateUser({ ...valid, email: 'sin-tld@x' }).error).toBe('Email inválido');
    expect(validateAdminCreateUser({ ...valid, email: '@solo-arroba.com' }).error).toBe('Email inválido');
  });

  it('password faltante → error', () => {
    expect(validateAdminCreateUser({ ...valid, password: '' }).error).toBe('Password requerido');
  });

  it('password < 6 chars → error', () => {
    expect(validateAdminCreateUser({ ...valid, password: 'abc12' }).error).toBe('Password mínimo 6 caracteres');
  });

  // Aquí está el bug exacto que tenía hyper-endpoint: aceptaba 'admin'
  // (minúscula) en lugar de 'Admin'. Test garantiza que NUNCA volvamos.
  it('rol con casing incorrecto ("admin") → error', () => {
    const r = validateAdminCreateUser({ ...valid, rol: 'admin' });
    expect(r.error).toBe('Rol inválido: admin');
  });

  it('rol sin tilde ("Produccion") → error', () => {
    const r = validateAdminCreateUser({ ...valid, rol: 'Produccion' });
    expect(r.error).toBe('Rol inválido: Produccion');
  });

  it('rol que no existe en el catálogo → error', () => {
    const r = validateAdminCreateUser({ ...valid, rol: 'Almacen' });
    expect(r.error).toBe('Rol inválido: Almacen');
  });

  it.each(ROLES_VALIDOS)('rol %s del catálogo → ok', (rol) => {
    const r = validateAdminCreateUser({ ...valid, rol });
    expect(r.ok).toBe(true);
    expect(r.rol).toBe(rol);
  });

  it('campos no string (number/object) → error porque no pasan los typeof guards', () => {
    expect(validateAdminCreateUser({ ...valid, nombre: 123 }).error).toBe('Nombre requerido');
    expect(validateAdminCreateUser({ ...valid, email: { x: 1 } }).error).toBe('Email requerido');
    expect(validateAdminCreateUser({ ...valid, password: 999999 }).error).toBe('Password requerido');
    expect(validateAdminCreateUser({ ...valid, rol: null }).error).toBe('Rol inválido: ');
  });
});

describe('mapAuthErrorToUserMessage', () => {
  it('mensaje vacío o null → mensaje genérico', () => {
    expect(mapAuthErrorToUserMessage(null)).toBe('Error al crear usuario');
    expect(mapAuthErrorToUserMessage('')).toBe('Error al crear usuario');
    expect(mapAuthErrorToUserMessage(undefined)).toBe('Error al crear usuario');
  });

  it('"User already registered" → "Ese correo ya está registrado"', () => {
    expect(mapAuthErrorToUserMessage('User already registered')).toBe('Ese correo ya está registrado');
    expect(mapAuthErrorToUserMessage('Email already exists in the system')).toBe('Ese correo ya está registrado');
    expect(mapAuthErrorToUserMessage('duplicate email value')).toBe('Ese correo ya está registrado');
  });

  it('password débil → mensaje guiado', () => {
    expect(mapAuthErrorToUserMessage('Password is too short')).toBe('Password muy débil — usa al menos 6 caracteres');
    expect(mapAuthErrorToUserMessage('weak password')).toBe('Password muy débil — usa al menos 6 caracteres');
  });

  it('email inválido → mensaje guiado', () => {
    expect(mapAuthErrorToUserMessage('Invalid email format')).toBe('Email inválido');
    expect(mapAuthErrorToUserMessage('email is invalid')).toBe('Email inválido');
  });

  it('mensaje no reconocido → se devuelve tal cual (técnico, pero útil)', () => {
    expect(mapAuthErrorToUserMessage('Database connection lost')).toBe('Database connection lost');
  });
});
