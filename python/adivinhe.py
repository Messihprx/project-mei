import random as rd

numero = rd.randint(1,10)
print("**********************************")
print("* Brincadeira de adivinhar       *")
print("* Escolha um número de 1 a 10    *")
print("**********************************")

escolha = int(input("digite o seu numero: "))

if escolha == numero:
    print(f"O numero escolhido foi {numero} ")
    print(f"Parabéns você acertou")
else:
    print(f"O numero escolhido foi {numero} ")
    print(f"Você perdeu")