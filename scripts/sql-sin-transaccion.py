#!/usr/bin/env python3
"""Rechaza un fichero SQL que controle su propia transacción.

Lo usan sql-ensayo.sh y sql-aplica.sh antes de conectarse a la base: la
transacción (BEGIN ... ROLLBACK o BEGIN ... COMMIT) la ponen siempre los
scripts, nunca el fichero. Ver docs/release.md, "Hallazgos de proceso"
(2026-10-02): un COMMIT dentro del fichero convirtió un ensayo en una
aplicación.

Rechaza, fuera de comentarios, cadenas y cuerpos $$…$$ (donde BEGIN/END de
plpgsql son legítimos):
  - sentencias que empiezan por BEGIN, COMMIT, ROLLBACK, END, ABORT, START,
    SAVEPOINT, RELEASE o PREPARE TRANSACTION;
  - cualquier metacomando de psql (líneas que empiezan por \\: \\i, \\c, …).
Sale con 0 si el fichero es válido y con 1 (listando los problemas) si no.
"""
import re
import sys

TX_WORDS = {'begin', 'commit', 'rollback', 'end', 'abort', 'start', 'savepoint', 'release'}


def problems(sql):
    found = []
    i, n, line = 0, len(sql), 1
    stmt, stmt_line = [], 1
    at_line_start = True

    def close_statement():
        text = ''.join(stmt).strip()
        words = re.findall(r'[A-Za-z_]+', text.lower())
        if words and (words[0] in TX_WORDS or words[:2] == ['prepare', 'transaction']):
            found.append(f'línea {stmt_line}: control de transacción ({" ".join(words[:2])})')

    while i < n:
        c = sql[i]
        if at_line_start and c == '\\':
            j = sql.find('\n', i)
            j = n if j == -1 else j
            found.append(f'línea {line}: metacomando de psql ({sql[i:j].strip()})')
            i = j
            continue
        if c == '\n':
            line += 1
            at_line_start = True
            stmt.append(c)
            i += 1
            continue
        if c not in ' \t\r':
            at_line_start = False
        if sql.startswith('--', i):
            j = sql.find('\n', i)
            i = n if j == -1 else j
            continue
        if sql.startswith('/*', i):
            j = sql.find('*/', i + 2)
            j = n if j == -1 else j + 2
            line += sql.count('\n', i, j)
            i = j
            continue
        if c == "'":
            j = i + 1
            while j < n:
                if sql[j] == "'" and sql.startswith("''", j):
                    j += 2
                    continue
                if sql[j] == "'":
                    break
                j += 1
            line += sql.count('\n', i, j)
            stmt.append(' ')
            i = j + 1
            continue
        m = re.match(r'\$([A-Za-z_][A-Za-z_0-9]*)?\$', sql[i:])
        if m:
            tag = m.group(0)
            j = sql.find(tag, i + len(tag))
            j = n if j == -1 else j + len(tag)
            line += sql.count('\n', i, j)
            stmt.append(' ')
            i = j
            continue
        if c == ';':
            close_statement()
            stmt, stmt_line = [], line
            i += 1
            continue
        if not ''.join(stmt).strip():
            stmt_line = line
        stmt.append(c)
        i += 1
    close_statement()
    return found


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('uso: sql-sin-transaccion.py <fichero.sql>')
    with open(sys.argv[1], encoding='utf-8') as f:
        bad = problems(f.read())
    if bad:
        print(f'RECHAZADO {sys.argv[1]}: el fichero no puede controlar su propia transacción '
              '(la ponen sql-ensayo.sh / sql-aplica.sh) ni usar metacomandos de psql:', file=sys.stderr)
        for b in bad:
            print(f'  - {b}', file=sys.stderr)
        sys.exit(1)
