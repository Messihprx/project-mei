import random as rd
import tkinter as tk
from tkinter import messagebox

def verificar_numero():
    try:
        escolha = int(entry.get())
    except ValueError:
        messagebox.showwarning("Erro", "Por favor, insira um número válido")
        return

    if escolha == numero:
        messagebox.showinfo("Resultado", f"O numero escolhido foi {numero}\nParabéns você acertou")
        root.destroy()
    elif escolha > 10:
        messagebox.showwarning("Erro", "O numero escolhido foi incorreto")
    else:
        messagebox.showinfo("Resultado", f"O numero escolhido foi {numero}\nVocê perdeu")

numero = rd.randint(1, 10)

root = tk.Tk()
root.title("Brincadeira de adivinhar")

tk.Label(root, text="**********************************").pack()
tk.Label(root, text="* Brincadeira de adivinhar       *").pack()
tk.Label(root, text="* Escolha um número de 1 a 10    *").pack()
tk.Label(root, text="**********************************").pack()

entry = tk.Entry(root)
entry.pack()

tk.Button(root, text="Verificar", command=verificar_numero).pack()

root.mainloop()