module.exports = {
    "env": {
        "es6": true
    },
    "extends": "eslint:recommended",
    "parserOptions": {
        "ecmaVersion": 2018,
        "sourceType": "module"
    },
    "rules": {
        "indent": [
            "error", 4, {
                "SwitchCase": 1,
                "CallExpression": {
                    "arguments": "off"
                },
                "FunctionDeclaration": {
                    "parameters": "off"
                },
                "FunctionExpression": {
                    "parameters": "off"
                }
            }
        ],
        "linebreak-style": [
            "error",
            "unix"
        ],
        "semi": [
            "error",
            "always"
        ],
        "brace-style": [
            "error",
            "allman", {
                "allowSingleLine": true
            }
        ],
        "no-unused-vars": [
            "error", {
                "varsIgnorePattern": "^unused_",
                "argsIgnorePattern": "^unused_"
            }
        ]
    }
};
