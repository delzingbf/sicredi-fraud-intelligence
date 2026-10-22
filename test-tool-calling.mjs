
const URL =
  "https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2024-10-08";

// Ferramentas simuladas para validar a integração.
const implementations = {
  getCustomerProfile: ({ customerId }) => {
    if (customerId !== "CUS-001") {
      return { error: "Associado não encontrado" };
    }

    return {
      customerId,
      averageAmount: 180,
      p95Amount: 650,
      usualPurchaseHours: "08:00-22:00",
      historicalTransactions: 42
    };
  },

  analyzeTransactionVelocity: ({ transactionId }) => {
    if (transactionId !== "TX-1001") {
      return { error: "Transação não encontrada" };
    }

    return {
      transactionId,
      transactionsLast10Minutes: 3,
      totalAmountLast10Minutes: 10800,
      velocityAnomaly: true
    };
  }
};

const tools = [
  {
    type: "function",
    function: {
      name: "getCustomerProfile",
      description: "Consulta o perfil histórico do associado.",
      parameters: {
        type: "object",
        properties: {
          customerId: { type: "string" }
        },
        required: ["customerId"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "analyzeTransactionVelocity",
      description:
        "Verifica transações recentes e possíveis rajadas.",
      parameters: {
        type: "object",
        properties: {
          transactionId: { type: "string" }
        },
        required: ["transactionId"]
      }
    }
  }
];

const messages = [
  {
    role: "system",
    content: [{
      type: "text",
      text: `Você é o agente investigador da Hello Moto.
Investigue transações usando ferramentas quando necessário.
Considere apenas evidências realmente retornadas.
Nunca declare fraude confirmada somente por anomalias.
Se faltarem informações, indique a incerteza.
Ao terminar, produza um relatório em português.`
    }]
  },
  {
    role: "user",
    content: [{
      type: "text",
      text: `Investigue a transação TX-1001,
do associado CUS-001.
Valor: R$ 4.800.
Horário: 03h15.

Você ainda não conhece o histórico do associado.
Consulte as ferramentas que considerar necessárias.`
    }]
  }
];

function parseArguments(raw) {
  let value = raw;
  // Alguns retornos podem conter JSON serializado como string.
  for (let i = 0; i < 2 && typeof value === "string"; i++) {
    value = JSON.parse(value);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Argumentos inválidos");
  }
  return value;
}

async function callGranite() {
  const response = await fetch(URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.IBM_ACCESS_TOKEN}`
    },
    body: JSON.stringify({
      project_id: process.env.IBM_PROJECT_ID,
      model_id: "ibm/granite-4-h-small",
      messages,
      tools,
      tool_choice_option: "auto",
      temperature: 0,
      max_tokens: 1200
    })
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(JSON.stringify(result));
  }

  return result.choices[0].message;
}

async function main() {
  if (!process.env.IBM_ACCESS_TOKEN ||
      !process.env.IBM_PROJECT_ID) {
    throw new Error("Configure as variáveis IBM.");
  }

  for (let round = 0; round < 4; round++) {
    console.log(`\n--- Rodada ${round + 1} ---`);

    const message = await callGranite();
    messages.push(message);

    const calls = message.tool_calls ?? [];

    if (calls.length === 0) {
      console.log("\nRELATÓRIO FINAL:");
      console.log(message.content);
      return;
    }

    for (const call of calls) {
      const name = call.function.name;
      console.log("Ferramenta solicitada:", name);

      let output;

      try {
        const args = parseArguments(call.function.arguments);

        if (!Object.hasOwn(implementations, name)) {
          throw new Error("Ferramenta não autorizada");
        }

        output = implementations[name](args);
      } catch (error) {
        output = { error: error.message };
      }

      console.log("Resultado:", output);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: [{
          type: "text",
          text: JSON.stringify(output)
        }]
      });
    }
  }

  console.log("Limite de investigação atingido.");
}

main().catch(error => {
  console.error("Erro:", error.message);
  process.exitCode = 1;
});
