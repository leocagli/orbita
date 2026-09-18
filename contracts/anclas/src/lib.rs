#![no_std]
//! Anclaje público del registro de consentimientos de Órbita.
//!
//! `anclar` no pide firma: deja el hash en el historial de la red (argumentos de la
//! transacción y un evento), que es permanente sin pagar alquiler. Así lo puede llamar un
//! relayer que paga la comisión. Además guarda el último hash en almacenamiento temporal:
//! los relayers no envían llamadas que no escriben nada, porque las toman por lecturas.
//! Quién ancló cada hash lo dice la lista pública de Órbita (`/v1/auditoria/anclajes`),
//! que apunta a cada transacción.

use soroban_sdk::{contract, contractevent, contractimpl, symbol_short, BytesN, Env, Symbol};

const ULTIMO: Symbol = symbol_short!("ultimo");

/// Se publicó el hash del registro con `filas` entradas.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Anclado {
    #[topic]
    pub hash: BytesN<32>,
    pub filas: u32,
}

#[contract]
pub struct Anclas;

#[contractimpl]
impl Anclas {
    /// Publica el hash y devuelve el número de ledger en que quedó.
    pub fn anclar(e: &Env, hash: BytesN<32>, filas: u32) -> u32 {
        e.storage().temporary().set(&ULTIMO, &(hash.clone(), filas));
        Anclado { hash, filas }.publish(e);
        e.ledger().sequence()
    }

    /// Último hash anclado, mientras siga en el almacenamiento temporal.
    pub fn ultimo(e: &Env) -> Option<(BytesN<32>, u32)> {
        e.storage().temporary().get(&ULTIMO)
    }
}

mod test;
